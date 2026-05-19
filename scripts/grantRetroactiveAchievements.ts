/**
 * v1.1, Retroactive achievement backfill.
 *
 * Scans every user's historical state and grants every achievement the
 * deterministic checks would have fired had the v1.1 system been live the
 * whole time. Idempotent: re-running is a no-op for already-earned rows
 * (the partial unique indexes on achievements_earned drop the dupes).
 *
 * Run BEFORE the v1.1 client release goes live so existing chroniclers
 * don't open the app to a barren ledger.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/grantRetroactiveAchievements.ts
 *
 * Requires the service-role key, RLS is bypassed by design so the script
 * can read and write across every user's data. Never embed the key in the
 * client bundle. Get it from the Supabase dashboard → Settings → API.
 *
 * What's backfilled:
 *   - chronicle_begins, known_by_name (any user with a character_name)
 *   - first_blood (any user with ≥1 quest completion)
 *   - reckoning_day (max single-day completion count ≥ 3)
 *   - bountiful_harvest (max single-month count ≥ 50)
 *   - dawns_own / night_watch (cumulative morning/evening completions ≥ 5)
 *   - polymath (≥ 5 distinct factions touched)
 *   - faction_devotee / forge_master (per-faction completion thresholds)
 *   - legendary_deed / triple_legend (legendary completions)
 *   - the_comeback (any quest gap ≥ 7 days between completions or
 *       create→complete)
 *   - strategist (current snapshot: 10 active across 3+ factions)
 *   - first_oath_held / keeper_of_oaths / long_watch / unbroken
 *       (sourced from xp_log streak_bonus rows so a broken streak still
 *       counts if the milestone was ever hit)
 *   - arc_completed (any campaign with status='completed')
 *   - final_page (365 days since profile.created_at)
 *
 * NOT backfilled (no audit trail exists):
 *   - penitent (no record of past +rest invocations)
 *   - cartographer_of_self (no record of past chronicle exports)
 *   - resurrected (last_seen_at is null until v1.1's onUserLogin runs)
 *
 * Logs per-user totals to stdout. Errors on any single user are caught
 * and logged so a bad row doesn't abort the whole sweep.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  ACHIEVEMENTS,
  type GrantCandidate,
  type ProgressUpdate,
  metadataKey,
} from '../lib/engine/achievements';

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BATCH_SIZE = 100;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    'Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY before running. ' +
      'Service-role key, not the anon key, the script writes across users.',
  );
  process.exit(1);
}

const client: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface ProfileRow {
  id: string;
  character_name: string | null;
  character_title: string | null;
  created_at: string;
}

interface QuestRow {
  id: string;
  tier: 'trivial' | 'minor' | 'standard' | 'major' | 'legendary';
  faction_id: string | null;
  status: 'active' | 'completed' | 'abandoned';
  recurrence: 'daily' | 'weekly' | null;
  created_at: string;
  completed_at: string | null;
  last_completed_at: string | null;
}

interface FactionRow {
  id: string;
  name: string;
}

interface CampaignRow {
  id: string;
  arc_name: string;
  faction_id: string | null;
  status: string;
}

interface XpLogRow {
  created_at: string;
  reason: string;
  quest_id: string | null;
}

interface PerUserStats {
  alreadyEarned: number;
  newlyGranted: number;
  errors: number;
}

async function loadEarnedKeys(userId: string): Promise<{
  oneShot: Set<string>;
  templates: Map<string, Set<string>>;
}> {
  const { data, error } = await client
    .from('achievements_earned')
    .select('achievement_code, metadata')
    .eq('user_id', userId);
  if (error) throw error;
  const oneShot = new Set<string>();
  const templates = new Map<string, Set<string>>();
  for (const row of (data ?? []) as { achievement_code: string; metadata: Record<string, unknown> | null }[]) {
    if (row.metadata == null) {
      oneShot.add(row.achievement_code);
    } else {
      const set = templates.get(row.achievement_code) ?? new Set<string>();
      set.add(metadataKey(row.achievement_code, row.metadata));
      templates.set(row.achievement_code, set);
    }
  }
  return { oneShot, templates };
}

async function insertGrants(userId: string, grants: GrantCandidate[]): Promise<number> {
  let inserted = 0;
  for (const g of grants) {
    const { error } = await client
      .from('achievements_earned')
      .insert({ user_id: userId, achievement_code: g.code, metadata: g.metadata });
    if (error) {
      // 23505 unique_violation = already there. Anything else is real.
      if ((error as { code?: string }).code === '23505') continue;
      throw error;
    }
    inserted++;
  }
  return inserted;
}

async function upsertProgress(userId: string, updates: ProgressUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const rows = updates.map((u) => ({
    user_id: userId,
    achievement_code: u.code,
    current_value: u.currentValue,
    target_value: u.targetValue,
    last_updated: new Date().toISOString(),
  }));
  const { error } = await client
    .from('achievement_progress')
    .upsert(rows, { onConflict: 'user_id,achievement_code' });
  if (error) throw error;
}

/**
 * Compute the set of achievements this user has earned over the lifetime
 * of their chronicle, given everything we can reconstruct from current
 * tables. Uses local-time hour/day boundaries (server-side, the script's
 * own runtime, close enough for backfill purposes).
 */
function computeRetroactiveGrants(
  profile: ProfileRow,
  quests: QuestRow[],
  factions: FactionRow[],
  campaigns: CampaignRow[],
  xpLog: XpLogRow[],
): { grants: GrantCandidate[]; progress: ProgressUpdate[] } {
  const grants: GrantCandidate[] = [];
  const progress: ProgressUpdate[] = [];
  const factionsById = new Map(factions.map((f) => [f.id, f.name]));
  const questsById = new Map(quests.map((q) => [q.id, q]));

  // Character creation grants, every user with a character_name has begun.
  if (profile.character_name) {
    grants.push({ code: 'chronicle_begins', metadata: null });
    if (profile.character_title) {
      grants.push({ code: 'known_by_name', metadata: null });
    }
  }

  // ---- Quest-completion-derived achievements -------------------------------
  const completions = xpLog.filter((r) => r.reason === 'quest_complete');
  if (completions.length >= 1) grants.push({ code: 'first_blood', metadata: null });

  // Single-day max + single-month max, group by local date / month string.
  const perDay = new Map<string, number>();
  const perMonth = new Map<string, number>();
  let beforeNine = 0;
  let afterTen = 0;
  let legendary = 0;
  const factionTouchedSet = new Set<string>();
  const completionsByFaction = new Map<string, number>();
  let comebackEverFired = false;

  // Track per-quest gaps for "the_comeback": for one-shot completions,
  // gap = create→complete. For recurring, look at successive xp_log
  // timestamps for the same quest_id and check intervals.
  const recurringSeqs = new Map<string, number[]>();

  for (const row of completions) {
    const t = new Date(row.created_at);
    if (Number.isNaN(t.getTime())) continue;
    const dayKey = `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
    const monthKey = `${t.getFullYear()}-${t.getMonth()}`;
    perDay.set(dayKey, (perDay.get(dayKey) ?? 0) + 1);
    perMonth.set(monthKey, (perMonth.get(monthKey) ?? 0) + 1);
    const hour = t.getHours();
    if (hour < 9) beforeNine++;
    if (hour >= 22) afterTen++;

    const q = row.quest_id ? questsById.get(row.quest_id) : null;
    if (q) {
      if (q.tier === 'legendary') legendary++;
      if (q.faction_id) {
        factionTouchedSet.add(q.faction_id);
        completionsByFaction.set(q.faction_id, (completionsByFaction.get(q.faction_id) ?? 0) + 1);
      }
      // One-shot comeback: created vs first (and only) completion.
      if (q.recurrence == null) {
        const created = new Date(q.created_at).getTime();
        const ageDays = (t.getTime() - created) / (1000 * 60 * 60 * 24);
        if (ageDays >= 7) comebackEverFired = true;
      } else {
        const arr = recurringSeqs.get(q.id) ?? [];
        arr.push(t.getTime());
        recurringSeqs.set(q.id, arr);
      }
    }
  }

  // Recurring comeback: any gap ≥ 7 days between successive completions.
  for (const arr of recurringSeqs.values()) {
    arr.sort((a, b) => a - b);
    for (let i = 1; i < arr.length; i++) {
      const gapDays = ((arr[i] ?? 0) - (arr[i - 1] ?? 0)) / (1000 * 60 * 60 * 24);
      if (gapDays >= 7) {
        comebackEverFired = true;
        break;
      }
    }
    if (comebackEverFired) break;
  }

  const maxPerDay = Math.max(0, ...Array.from(perDay.values()));
  const maxPerMonth = Math.max(0, ...Array.from(perMonth.values()));

  if (maxPerDay >= 3) grants.push({ code: 'reckoning_day', metadata: null });
  if (maxPerMonth >= 50) grants.push({ code: 'bountiful_harvest', metadata: null });
  if (beforeNine >= 5) grants.push({ code: 'dawns_own', metadata: null });
  if (afterTen >= 5) grants.push({ code: 'night_watch', metadata: null });
  if (factionTouchedSet.size >= 5) grants.push({ code: 'polymath', metadata: null });
  if (legendary >= 1) grants.push({ code: 'legendary_deed', metadata: null });
  if (legendary >= 3) grants.push({ code: 'triple_legend', metadata: null });
  if (comebackEverFired) grants.push({ code: 'the_comeback', metadata: null });

  // Per-faction templates.
  for (const [fid, count] of completionsByFaction.entries()) {
    const fname = factionsById.get(fid) ?? 'A faction';
    if (count >= 25) {
      grants.push({ code: 'faction_devotee', metadata: { faction_id: fid, faction_name: fname } });
    }
    if (count >= 100) {
      grants.push({ code: 'forge_master', metadata: { faction_id: fid, faction_name: fname } });
    }
  }

  // Strategist, current snapshot only (we can't reconstruct historical
  // active-quest counts).
  const active = quests.filter((q) => q.status === 'active');
  const activeFactions = new Set(active.map((q) => q.faction_id).filter((f): f is string => !!f));
  if (active.length >= 10 && activeFactions.size >= 3) {
    grants.push({ code: 'strategist', metadata: null });
  }

  // ---- Streak milestones ---------------------------------------------------
  // Source from xp_log streak_bonus rows so a broken streak still counts.
  const sawBonus = new Map<string, boolean>(); // 7|30|100 → bool
  let weeklyBonusForDailyQuest = false;
  for (const row of xpLog) {
    if (!row.reason.startsWith('streak_bonus_')) continue;
    const milestone = row.reason.slice('streak_bonus_'.length);
    sawBonus.set(milestone, true);
    if (milestone === '7' && row.quest_id) {
      const q = questsById.get(row.quest_id);
      if (q?.recurrence === 'daily') weeklyBonusForDailyQuest = true;
    }
  }
  if (sawBonus.get('7')) grants.push({ code: 'first_oath_held', metadata: null });
  if (weeklyBonusForDailyQuest) grants.push({ code: 'keeper_of_oaths', metadata: null });
  if (sawBonus.get('30')) grants.push({ code: 'long_watch', metadata: null });
  if (sawBonus.get('100')) grants.push({ code: 'unbroken', metadata: null });

  // ---- Campaign completions (template) ------------------------------------
  for (const c of campaigns) {
    if (c.status === 'completed') {
      grants.push({
        code: 'arc_completed',
        metadata: { campaign_id: c.id, arc_name: c.arc_name, faction_id: c.faction_id },
      });
    }
  }

  // ---- Final page (365 days since character creation) ---------------------
  const ageMs = Date.now() - new Date(profile.created_at).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  if (ageDays >= 365) grants.push({ code: 'final_page', metadata: null });

  // ---- Progress for in-flight quantitative achievements -------------------
  // Only push progress for codes that are NOT in the grants list, that way
  // the screen shows progress meters for users who are partway there.
  const grantedCodes = new Set(grants.map((g) => g.code));
  const pushProgress = (code: string, current: number, target: number) => {
    if (grantedCodes.has(code)) return;
    if (current <= 0) return;
    progress.push({ code, currentValue: Math.min(current, target), targetValue: target });
  };
  pushProgress('reckoning_day', maxPerDay, 3);
  pushProgress('bountiful_harvest', maxPerMonth, 50);
  pushProgress('dawns_own', beforeNine, 5);
  pushProgress('night_watch', afterTen, 5);
  pushProgress('polymath', factionTouchedSet.size, 5);
  pushProgress('triple_legend', legendary, 3);

  return { grants, progress };
}

async function processUser(profile: ProfileRow): Promise<PerUserStats> {
  const stats: PerUserStats = { alreadyEarned: 0, newlyGranted: 0, errors: 0 };
  try {
    const [questsRes, factionsRes, campaignsRes, xpLogRes, alreadyEarned] = await Promise.all([
      client
        .from('quests')
        .select('id, tier, faction_id, status, recurrence, created_at, completed_at, last_completed_at')
        .eq('user_id', profile.id),
      client.from('factions').select('id, name').eq('user_id', profile.id),
      client.from('campaigns').select('id, arc_name, faction_id, status').eq('user_id', profile.id),
      client.from('xp_log').select('created_at, reason, quest_id').eq('user_id', profile.id),
      loadEarnedKeys(profile.id),
    ]);
    if (questsRes.error) throw questsRes.error;
    if (factionsRes.error) throw factionsRes.error;
    if (campaignsRes.error) throw campaignsRes.error;
    if (xpLogRes.error) throw xpLogRes.error;

    const { grants, progress } = computeRetroactiveGrants(
      profile,
      (questsRes.data ?? []) as QuestRow[],
      (factionsRes.data ?? []) as FactionRow[],
      (campaignsRes.data ?? []) as CampaignRow[],
      (xpLogRes.data ?? []) as XpLogRow[],
    );

    // Filter out already-granted before insert to keep logs accurate
    // (insertGrants would still skip them via the unique index).
    const toInsert = grants.filter((g) => {
      if (g.metadata == null) return !alreadyEarned.oneShot.has(g.code);
      const set = alreadyEarned.templates.get(g.code);
      return !set || !set.has(metadataKey(g.code, g.metadata));
    });
    stats.alreadyEarned = grants.length - toInsert.length;
    stats.newlyGranted = await insertGrants(profile.id, toInsert);

    await upsertProgress(profile.id, progress);
  } catch (e) {
    stats.errors++;
    console.error(`[user ${profile.id}] failed:`, e);
  }
  return stats;
}

async function main(): Promise<void> {
  console.log('- Achievement retroactive backfill -');
  console.log(`Registry: ${ACHIEVEMENTS.length} achievements`);
  console.log(`Batch size: ${BATCH_SIZE}`);

  let from = 0;
  let totalUsers = 0;
  let totalGrantedNew = 0;
  let totalAlready = 0;
  let totalErrors = 0;

  for (;;) {
    const { data: users, error } = await client
      .from('profiles')
      .select('id, character_name, character_title, created_at')
      .order('id', { ascending: true })
      .range(from, from + BATCH_SIZE - 1);
    if (error) {
      console.error('Failed to read profiles:', error);
      process.exit(2);
    }
    if (!users || users.length === 0) break;

    for (const u of users as ProfileRow[]) {
      const stats = await processUser(u);
      totalUsers++;
      totalGrantedNew += stats.newlyGranted;
      totalAlready += stats.alreadyEarned;
      totalErrors += stats.errors;
      console.log(
        `  user=${u.id} new=${stats.newlyGranted} already=${stats.alreadyEarned} errors=${stats.errors}`,
      );
    }

    from += BATCH_SIZE;
    if (users.length < BATCH_SIZE) break;
  }

  console.log('');
  console.log('- Done -');
  console.log(`Users processed: ${totalUsers}`);
  console.log(`New grants: ${totalGrantedNew}`);
  console.log(`Already earned (skipped): ${totalAlready}`);
  console.log(`Errors: ${totalErrors}`);
  process.exit(totalErrors > 0 ? 1 : 0);
}

void main();
