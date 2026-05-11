// Achievements screen — All / Earned / In Progress / Locked tabs.
//
// Reads the user's snapshot via loadAchievementSnapshot, joins it against
// the static registry, and groups by status. Templates (faction_devotee,
// forge_master, arc_completed) collapse into an expanding ledger so a
// chronicler with many earned instances doesn't see 30+ duplicate cards.
//
// Hidden achievements stay locked behind "???" until earned, with a short
// in-voice hint surfacing once progress crosses 50% of targetValue.

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { useAuth } from '../../lib/auth';
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

type Tab = 'all' | 'earned' | 'progress' | 'locked';

const TABS: { key: Tab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'earned', label: 'Earned' },
  { key: 'progress', label: 'In Progress' },
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
      return () => {
        cancelled = true;
      };
    }, [session?.user.id]),
  );

  const views = useMemo(() => (snapshot ? buildViews(snapshot) : []), [snapshot]);
  const filtered = useMemo(() => {
    if (activeTab === 'all') return views;
    return views.filter((v) => statusFor(v) === activeTab);
  }, [views, activeTab]);

  const earnedCount = views.filter((v) => v.earned.length > 0 && !v.achievement.isTemplate).length;
  const earnedTitles = 0; // No Title template in v1.1; Rank Ascended dropped.
  const earnedArcs = views.find((v) => v.achievement.code === 'arc_completed')?.earned.length ?? 0;
  const totalNonTemplate = ACHIEVEMENTS.filter((a) => !a.isTemplate).length;

  return (
    <ParchmentScreen>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-20 pb-12">
        <Pressable onPress={() => router.back()} className="mb-4 active:opacity-60">
          <Text className="font-body text-lg text-amber-800">← Back</Text>
        </Pressable>

        <Text className="mb-1 font-display text-4xl text-stone-900">Achievements</Text>
        <Text className="mb-6 font-body text-lg text-stone-500">
          {earnedCount} / {totalNonTemplate} inscribed
          {earnedTitles > 0 ? ` · ${earnedTitles} titles` : ''}
          {earnedArcs > 0 ? ` · ${earnedArcs} arcs` : ''}
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
        ) : filtered.length === 0 ? (
          <Text className="mt-8 font-body italic text-stone-500">
            No achievements in this category yet.
          </Text>
        ) : (
          <View className="gap-3">
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
      <View className="mb-1 flex-row items-baseline justify-between">
        <Text className="flex-1 pr-3 font-display-bold text-xl text-stone-900">
          {hidden ? '???' : achievement.name}
        </Text>
        <Text className="font-display text-xs uppercase tracking-widest text-amber-800">
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
