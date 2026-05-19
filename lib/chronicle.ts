// `+chronicle` export, dumps the user's full state as a plain-text file.
//
// Works cross-platform: on web we trigger a Blob download; on native we
// write to FileSystem and hand off to the Sharing API. Generation is pure
// (testable); platform-specific download lives behind shareChronicle.

import { Platform } from 'react-native';

import { onChronicleExport } from './engine/achievementTriggers';
import { calculateLevel } from './engine/xp';
import { listActiveDebuffs } from './debuffs';
import { errorMessage } from './errors';
import { getCurrentProfile, listCampaigns, listFactions } from './profile';
import { listQuests } from './quests';
import { supabase } from './supabase';
import type { Campaign, Faction, Profile, Quest } from './types/models';

interface ChronicleSnapshot {
  profile: Profile | null;
  factions: Faction[];
  campaigns: Campaign[];
  activeQuests: Quest[];
  completedQuests: Quest[];
  abandonedQuests: Quest[];
  debuffs: { name: string; xp_modifier_pct: number; effect_description: string | null }[];
}

/** Pull every relevant row in parallel. RLS filters to the caller. */
async function loadSnapshot(): Promise<ChronicleSnapshot> {
  const [profile, factions, campaignsActive, campaignsCompleted, active, completed, abandoned, debuffs] =
    await Promise.all([
      getCurrentProfile(),
      listFactions(),
      listCampaigns('active'),
      listCampaigns('completed'),
      listQuests('active'),
      listQuests('completed'),
      listQuests('abandoned'),
      listActiveDebuffs(),
    ]);
  return {
    profile,
    factions,
    campaigns: [...campaignsActive, ...campaignsCompleted],
    activeQuests: active,
    completedQuests: completed,
    abandonedQuests: abandoned,
    debuffs: debuffs.map((d) => ({
      name: d.name,
      xp_modifier_pct: d.xp_modifier_pct,
      effect_description: d.effect_description,
    })),
  };
}

function shortDate(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatQuest(q: Quest): string {
  const lines = [`  • ${q.title}`];
  lines.push(`      tier: ${q.tier} · classification: ${q.classification} · ${q.xp_reward} XP`);
  if (q.recurrence) {
    lines.push(`      recurrence: ${q.recurrence} · streak: ${q.streak_count}`);
  }
  if (q.deadline) lines.push(`      deadline: ${shortDate(q.deadline)}`);
  if (q.completed_at) lines.push(`      completed: ${shortDate(q.completed_at)}`);
  if (q.abandoned_at) lines.push(`      abandoned: ${shortDate(q.abandoned_at)}`);
  if (q.description) lines.push(`      ${q.description.replace(/\s+/g, ' ').trim()}`);
  if (q.objectives.length > 0) {
    lines.push('      objectives:');
    for (const o of q.objectives) {
      lines.push(`        ${o.completed ? '☑' : '☐'} ${o.text}`);
    }
  }
  return lines.join('\n');
}

/**
 * Build the chronicle string. Pure over its input, see the test for shape.
 */
export function renderChronicle(snap: ChronicleSnapshot, now: Date = new Date()): string {
  const lines: string[] = [];
  const name = snap.profile?.character_name ?? snap.profile?.display_name ?? 'Wanderer';
  const title = snap.profile?.character_title ?? 'Untitled';
  const totalXp = snap.profile?.total_xp ?? 0;
  const { level } = calculateLevel(totalXp);

  lines.push('═══════════════════════════════════════════════════');
  lines.push(`  THE CHRONICLE OF ${name.toUpperCase()}`);
  lines.push(`  ${title}`);
  lines.push(`  Level ${level} · ${totalXp.toLocaleString()} XP · ${snap.profile?.difficulty ?? 'adept'}`);
  lines.push(`  Inscribed ${now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
  lines.push('═══════════════════════════════════════════════════');
  lines.push('');

  lines.push('FACTIONS');
  if (snap.factions.length === 0) {
    lines.push('  none');
  } else {
    for (const f of snap.factions) {
      lines.push(`  • ${f.name}`);
      lines.push(`      ${f.real_world_domain}`);
    }
  }
  lines.push('');

  lines.push('CAMPAIGNS');
  if (snap.campaigns.length === 0) {
    lines.push('  none');
  } else {
    for (const c of snap.campaigns) {
      lines.push(`  • ${c.arc_name} [${c.status}, ${c.progress_pct}%]`);
      lines.push(`      ${c.real_world_goal}`);
    }
  }
  lines.push('');

  lines.push(`ACTIVE QUESTS (${snap.activeQuests.length})`);
  if (snap.activeQuests.length === 0) {
    lines.push('  none');
  } else {
    for (const q of snap.activeQuests) lines.push(formatQuest(q));
  }
  lines.push('');

  lines.push(`COMPLETED QUESTS (${snap.completedQuests.length})`);
  if (snap.completedQuests.length === 0) {
    lines.push('  none');
  } else {
    for (const q of snap.completedQuests) lines.push(formatQuest(q));
  }
  lines.push('');

  lines.push(`ABANDONED QUESTS (${snap.abandonedQuests.length})`);
  if (snap.abandonedQuests.length === 0) {
    lines.push('  none');
  } else {
    for (const q of snap.abandonedQuests) lines.push(formatQuest(q));
  }
  lines.push('');

  if (snap.debuffs.length > 0) {
    lines.push('DEBUFFS');
    for (const d of snap.debuffs) {
      lines.push(`  • ${d.name} (${d.xp_modifier_pct}%)`);
      if (d.effect_description) lines.push(`      ${d.effect_description}`);
    }
    lines.push('');
  }

  lines.push('- end of chronicle -');
  return lines.join('\n');
}

/**
 * Generate + hand off to the platform's download/share path. Returns when
 * the share sheet is dismissed (native) or the download is initiated (web).
 */
/** Fire-and-forget achievement trigger. Looked up at the call site rather
 *  than top-of-function so a missing session doesn't abort the export. */
async function fireExportAchievement(): Promise<void> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) void onChronicleExport(user.id);
  } catch (e) {
    console.warn('[achievements] post-export fire failed', e);
  }
}

export async function shareChronicle(): Promise<void> {
  const snap = await loadSnapshot();
  const text = renderChronicle(snap);
  const date = new Date().toISOString().slice(0, 10);
  const filename = `questline-chronicle-${date}.txt`;

  if (Platform.OS === 'web') {
    // Trigger an anchor click, browser saves as the requested filename.
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    void fireExportAchievement();
    return;
  }

  // Native: dynamically import expo-file-system + expo-sharing so this
  // module stays loadable on web (where they'd warn about missing modules).
  // expo-file-system v19 uses a File/Paths object API rather than the
  // legacy free functions.
  try {
    const FS = await import('expo-file-system');
    const Sharing = await import('expo-sharing');
    const file = new FS.File(FS.Paths.cache, filename);
    if (file.exists) file.delete();
    file.create();
    file.write(text);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, { dialogTitle: 'Export chronicle' });
    } else {
      throw new Error('Sharing unavailable on this device.');
    }
    void fireExportAchievement();
  } catch (e) {
    throw new Error(`Chronicle export failed: ${errorMessage(e)}`);
  }
}
