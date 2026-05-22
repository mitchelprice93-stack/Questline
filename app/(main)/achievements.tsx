// Achievements screen, All / Earned / Personal / Locked tabs.
//
// "Earned" and "Locked" come from the predefined ACHIEVEMENTS registry
// joined against the user's snapshot. "Personal" lists campaign
// achievements (AI-generated per arc the chronicler has finished). "All"
// interleaves both, newest earned-or-locked-with-progress first for the
// predefined ones plus all Personal trophies.
//
// In Progress was removed as a separate tab; locked cards still show their
// progress meter inline, which covers the same surface without a tab.
//
// Hidden achievements stay locked behind "???" until earned, with a short
// in-voice hint surfacing once progress crosses 50% of targetValue.

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { useAuth } from '../../lib/auth';
import {
  listCampaignAchievements,
  earnAchievementForCampaign,
} from '../../lib/campaign-achievements';
import {
  ACHIEVEMENTS,
  renderFlavor,
  type Achievement,
  type AchievementTier,
} from '../../lib/engine/achievements';
import {
  loadAchievementSnapshot,
  type AchievementSnapshot,
} from '../../lib/engine/achievementTriggers';
import { errorMessage } from '../../lib/errors';
import { ParchmentScreen } from '../../lib/parchment';
import { listCampaigns } from '../../lib/profile';
import { supabase } from '../../lib/supabase';
import type { CampaignAchievement } from '../../lib/types/models';

type Tab = 'all' | 'earned' | 'personal' | 'locked';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'earned', label: 'Earned' },
  { key: 'personal', label: 'Personal' },
  { key: 'locked', label: 'Locked' },
];

const TIER_BORDER: Record<AchievementTier, string> = {
  common: 'border-stone-700',
  uncommon: 'border-emerald-800',
  rare: 'border-amber-600',
  legendary: 'border-amber-400',
};

const TIER_BG: Record<AchievementTier, string> = {
  common: 'bg-amber-50/40',
  uncommon: 'bg-emerald-50/30',
  rare: 'bg-amber-100/50',
  legendary: 'bg-amber-200/60',
};

const TIER_LABEL: Record<AchievementTier, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  legendary: 'Legendary',
};

interface EarnedInstance {
  metadata: Record<string, unknown> | null;
  earnedAt: string;
}

interface AchievementView {
  achievement: Achievement;
  /** Earned instances. Empty array = not earned (one-shot) or no template
   *  rows yet. Length > 1 only for templates. */
  earned: EarnedInstance[];
  /** Snapshot progress entry, if one exists. */
  progress: { current: number; target: number } | null;
}

function buildViews(snap: AchievementSnapshot): AchievementView[] {
  const earnedByCode = new Map<string, EarnedInstance[]>();
  for (const row of snap.earned) {
    const list = earnedByCode.get(row.code) ?? [];
    list.push({ metadata: row.metadata, earnedAt: row.earnedAt });
    earnedByCode.set(row.code, list);
  }
  const progressByCode = new Map<string, { current: number; target: number }>();
  for (const p of snap.progress) {
    progressByCode.set(p.code, { current: p.current, target: p.target });
  }
  return ACHIEVEMENTS.map((a) => ({
    achievement: a,
    earned: earnedByCode.get(a.code) ?? [],
    progress: progressByCode.get(a.code) ?? null,
  }));
}

function statusFor(view: AchievementView): 'earned' | 'progress' | 'locked' {
  if (view.earned.length > 0 && !view.achievement.isTemplate) return 'earned';
  if (view.earned.length > 0 && view.achievement.isTemplate) {
    // Templates with at least one earned instance count as "earned" for
    // the tab filter. They still appear in "All" with the ledger expanded.
    return 'earned';
  }
  if (view.progress && view.progress.current > 0 && view.progress.current < view.progress.target) {
    return 'progress';
  }
  return 'locked';
}

export default function AchievementsScreen() {
  const { session } = useAuth();
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<AchievementSnapshot | null>(null);
  const [personal, setPersonal] = useState<CampaignAchievement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('all');

  useFocusEffect(
    useCallback(() => {
      if (!session?.user.id) return;
      const userId = session.user.id;
      let cancelled = false;
      setError(null);
      loadAchievementSnapshot(userId)
        .then((s) => {
          if (!cancelled) setSnapshot(s);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(errorMessage(e));
        });

      // Personal achievements (campaign-derived). Load the list, then run
      // a one-shot backfill for any completed campaign that doesn't yet
      // have a trophy row. The backfill is sequential with a short delay
      // so it doesn't hammer the AI proxy; failures are non-fatal (next
      // mount tries again).
      void (async () => {
        try {
          const initial = await listCampaignAchievements();
          if (!cancelled) setPersonal(initial);
          await backfillMissingCampaignAchievements(initial);
          if (cancelled) return;
          // Re-fetch after backfill so newly inserted rows show up.
          const after = await listCampaignAchievements();
          if (!cancelled) setPersonal(after);
        } catch (e) {
          if (!cancelled) setError(errorMessage(e));
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [session?.user.id]),
  );

  const views = useMemo(() => (snapshot ? buildViews(snapshot) : []), [snapshot]);
  // For the predefined achievement cards: All shows everything; Earned and
  // Locked filter to their respective statuses; Personal shows none of the
  // predefined cards (Personal is its own list rendered below).
  const filtered = useMemo(() => {
    if (activeTab === 'all' || activeTab === 'earned' || activeTab === 'locked') {
      if (activeTab === 'all') return views;
      return views.filter((v) => statusFor(v) === activeTab);
    }
    return []; // Personal tab hides predefined cards.
  }, [views, activeTab]);

  // Personal achievement cards. All + Personal show them; Earned/Locked do not
  // (a Personal trophy is by definition earned, never locked, so it'd just
  // double-count under Earned).
  const personalToShow = useMemo<CampaignAchievement[]>(() => {
    if (!personal) return [];
    if (activeTab === 'all' || activeTab === 'personal') return personal;
    return [];
  }, [personal, activeTab]);

  const earnedCount = views.filter((v) => v.earned.length > 0 && !v.achievement.isTemplate).length;
  const earnedTitles = 0; // No Title template in v1.1; Rank Ascended dropped.
  const earnedArcs = views.find((v) => v.achievement.code === 'arc_completed')?.earned.length ?? 0;
  const totalNonTemplate = ACHIEVEMENTS.filter((a) => !a.isTemplate).length;
  const personalCount = personal?.length ?? 0;

  return (
    <ParchmentScreen>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-20 pb-12">
        {/* Explicit route to /character-sheet, router.back() in an Expo
            Router Tabs setup unwinds to the initial tab (Quest Board), not
            the previous screen. Achievements is only reached from the
            character sheet's Achievements card. */}
        <Pressable
          onPress={() => router.replace('/character-sheet')}
          className="mb-4 active:opacity-60"
        >
          <Text className="font-body text-lg text-amber-800">← Back</Text>
        </Pressable>

        <Text className="mb-1 font-display text-4xl text-stone-900">Achievements</Text>
        <Text className="mb-6 font-body text-lg text-stone-500">
          {earnedCount} / {totalNonTemplate} inscribed
          {earnedTitles > 0 ? ` · ${earnedTitles} titles` : ''}
          {earnedArcs > 0 ? ` · ${earnedArcs} arcs` : ''}
          {personalCount > 0
            ? ` · ${personalCount} personal ${personalCount === 1 ? 'trophy' : 'trophies'}`
            : ''}
        </Text>

        {/* Tab strip */}
        <View className="mb-4 flex-row gap-2">
          {TABS.map((tab) => {
            const selected = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                className={`flex-1 rounded-md border px-2 py-2 ${
                  selected
                    ? 'border-amber-600 bg-amber-900/40'
                    : 'border-stone-800 bg-amber-50/40 active:bg-amber-100/60'
                }`}
              >
                <Text
                  className={`text-center font-body-medium text-base uppercase tracking-widest ${
                    selected ? 'text-amber-800' : 'text-stone-700'
                  }`}
                >
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {error ? (
          <Text className="font-body text-xl text-red-700">{error}</Text>
        ) : !snapshot ? (
          <ActivityIndicator className="mt-8" color="#92400e" />
        ) : filtered.length === 0 && personalToShow.length === 0 ? (
          <Text className="mt-8 font-body italic text-stone-500">
            {activeTab === 'personal'
              ? 'No campaign trophies yet. Finish a campaign to inscribe your first.'
              : 'No achievements in this category yet.'}
          </Text>
        ) : (
          <View className="gap-3">
            {personalToShow.map((row) => (
              <CampaignAchievementCard key={row.id} row={row} />
            ))}
            {filtered.map((view) => (
              <AchievementCard key={view.achievement.code} view={view} />
            ))}
          </View>
        )}
      </ScrollView>
    </ParchmentScreen>
  );
}

function AchievementCard({ view }: { view: AchievementView }) {
  const { achievement, earned, progress } = view;
  const isEarned = earned.length > 0;
  const isLocked = !isEarned;
  const tier = achievement.tier;
  const border = TIER_BORDER[tier];
  const bg = TIER_BG[tier];

  // Hidden + locked → "???". Hidden + has progress past 50% → reveal hint.
  const hidden = achievement.hidden && isLocked;
  const halfProgress =
    progress != null && progress.target > 0 && progress.current * 2 >= progress.target;
  const showHint = hidden && halfProgress && achievement.hintAt50pct;

  return (
    <View className={`rounded-md border-2 ${border} ${bg} px-4 py-3`}>
      <View className="mb-1 flex-row items-start justify-between">
        <Text
          className="flex-1 pr-3 font-display-bold text-xl text-stone-900"
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {hidden ? '???' : achievement.name}
        </Text>
        {/* Same anti-wrap treatment as the Personal badge: shrink-0 to
            preserve natural width, numberOfLines={1} so the badge can't
            split (Legendary in particular is wide enough to risk it). */}
        <Text
          className="shrink-0 font-display text-xs uppercase tracking-wider text-amber-800"
          numberOfLines={1}
        >
          {TIER_LABEL[tier]}
        </Text>
      </View>

      {hidden ? (
        <Text className="font-body italic text-stone-500">
          {showHint ? achievement.hintAt50pct : 'A condition the Tome has not yet revealed.'}
        </Text>
      ) : achievement.isTemplate ? (
        <TemplateLedger view={view} />
      ) : (
        <>
          <Text className="font-body text-base text-stone-700">
            {renderFlavor(achievement, null)}
          </Text>
          {isEarned ? (
            <Text className="mt-1 font-body text-sm text-amber-800">
              Inscribed {shortDate(earned[0]?.earnedAt ?? '')}
            </Text>
          ) : progress ? (
            <ProgressMeter current={progress.current} target={progress.target} />
          ) : null}
        </>
      )}
    </View>
  );
}

function TemplateLedger({ view }: { view: AchievementView }) {
  const { achievement, earned } = view;
  if (earned.length === 0) {
    return (
      <Text className="font-body italic text-stone-500">
        A template inscription. Each instance earned will appear here.
      </Text>
    );
  }
  return (
    <View className="gap-1">
      {earned.map((instance, i) => (
        <View key={i} className="flex-row items-baseline justify-between">
          <Text className="flex-1 pr-3 font-body text-base text-stone-700">
            {renderFlavor(achievement, instance.metadata)}
          </Text>
          <Text className="font-body text-sm text-amber-800">
            {shortDate(instance.earnedAt)}
          </Text>
        </View>
      ))}
    </View>
  );
}

function ProgressMeter({ current, target }: { current: number; target: number }) {
  const pct = Math.min(100, Math.round((current / target) * 100));
  return (
    <View className="mt-2">
      <View className="mb-1 flex-row items-baseline justify-between">
        <Text className="font-body text-sm text-stone-600">Progress</Text>
        <Text className="font-body text-sm text-stone-600">
          {current} / {target}
        </Text>
      </View>
      <View className="h-1.5 overflow-hidden rounded-full bg-amber-100/60">
        <View className="h-1.5 rounded-full bg-amber-600" style={{ width: `${pct}%` }} />
      </View>
    </View>
  );
}

function shortDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function CampaignAchievementCard({ row }: { row: CampaignAchievement }) {
  // Personal trophies render in the same visual family as predefined
  // achievement cards (parchment box, amber accents) but with the
  // AI-generated title front-and-center.
  //
  // Title: flex-1 + up to 2 lines + auto-shrink. The "Personal" badge to the
  // right takes a fixed width, so on a narrow phone with a long AI title the
  // remaining space can be tight; allowing two lines plus fontSize shrink
  // keeps the title fully visible without truncation.
  return (
    <View className="rounded-md border-2 border-amber-600 bg-amber-100/50 px-4 py-3">
      <View className="mb-1 flex-row items-start justify-between">
        <Text
          className="flex-1 pr-3 font-display-bold text-xl text-stone-900"
          numberOfLines={2}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {row.title}
        </Text>
        {/* shrink-0 keeps the badge at its natural width so the flex-1
            title can't squeeze it and force the L to wrap below.
            numberOfLines={1} is the safety net in case a future tweak
            ever brings tracking back wide enough to push it. */}
        <Text
          className="shrink-0 font-display text-xs uppercase tracking-wider text-amber-800"
          numberOfLines={1}
        >
          Personal
        </Text>
      </View>
      <Text className="font-body text-base text-stone-700" numberOfLines={6}>
        {row.description}
      </Text>
      <Text className="mt-1 font-body text-sm text-amber-800" numberOfLines={1}>
        Inscribed {shortDate(row.earned_at)}
      </Text>
    </View>
  );
}

/** For each campaign with status='completed' that doesn't yet have a
 *  campaign_achievements row, generate one. Sequential with a short delay
 *  between calls so we don't burst the AI proxy. Backdates earned_at to
 *  the campaign's most-recent quest-completion timestamp when available
 *  so the gallery date matches when the work actually finished. */
async function backfillMissingCampaignAchievements(
  existing: CampaignAchievement[],
): Promise<void> {
  try {
    // Both 'completed' and any active campaign at progress_pct=100 should
    // be backfilled; the live trigger should have already caught most of
    // these but a user who completed a campaign before this feature shipped
    // will have status='completed' with no row.
    const completedCampaigns = await listCampaigns('completed');
    const haveRows = new Set(existing.map((r) => r.campaign_id));
    const missing = completedCampaigns.filter((c) => !haveRows.has(c.id));
    if (missing.length === 0) return;

    for (const c of missing) {
      // Find the campaign's most-recent quest completion timestamp; use it
      // as earned_at so the trophy date lines up with the finish. If no
      // completions are found, fall back to the campaign's created_at.
      let earnedAtIso: string | undefined;
      try {
        const { data: lastCompletion } = await supabase
          .from('quests')
          .select('completed_at, last_completed_at')
          .eq('campaign_id', c.id)
          .order('completed_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        const candidate =
          (lastCompletion?.completed_at as string | null | undefined) ??
          (lastCompletion?.last_completed_at as string | null | undefined);
        if (candidate) earnedAtIso = candidate;
      } catch {
        // Non-fatal; fall through with undefined earnedAtIso (server uses now()).
      }
      try {
        await earnAchievementForCampaign({
          campaignId: c.id,
          arcName: c.arc_name,
          realWorldGoal: c.real_world_goal,
          earnedAtIso,
        });
      } catch (e) {
        console.warn('[backfill] campaign achievement failed', c.id, e);
      }
      // Brief pause so the daily-cost cap doesn't trip and the AI proxy
      // isn't slammed when a user has a backlog of completed campaigns.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  } catch (e) {
    console.warn('[backfill] failed to enumerate completed campaigns', e);
  }
}
