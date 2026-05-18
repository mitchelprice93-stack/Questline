import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { DropdownPicker, type DropdownOption } from '../../../components/dropdown-picker';
import { TutorialTarget } from '../../../components/tutorial-target';
import { useAuth } from '../../../lib/auth';
import {
  deadlineUrgency,
  formatDeadlineRelative,
  recurrenceStatusLabel,
  urgencyClasses,
} from '../../../lib/dates';
import { type QuestTier } from '../../../lib/engine/xp';
import { ParchmentScreen } from '../../../lib/parchment';
import { listFactions } from '../../../lib/profile';
import {
  applyQuestFilters,
  listQuests,
  type QuestFilters,
  type TimeRange,
} from '../../../lib/quests';
import { playSfx } from '../../../lib/sfx';
import { FREE_TIER_QUEST_CAP } from '../../../lib/subscription';
import type { Faction, Quest, QuestStatus } from '../../../lib/types/models';

const STATUS_TABS: { key: QuestStatus; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'abandoned', label: 'Abandoned' },
];

const TIER_FILTER_OPTIONS: DropdownOption<QuestTier | 'all'>[] = [
  { value: 'all', label: 'All tiers' },
  { value: 'trivial', label: 'Trivial' },
  { value: 'minor', label: 'Minor' },
  { value: 'standard', label: 'Standard' },
  { value: 'major', label: 'Major' },
  { value: 'legendary', label: 'Legendary' },
];

const TIME_RANGE_OPTIONS: DropdownOption<TimeRange>[] = [
  { value: 'all', label: 'All time' },
  { value: '30d', label: 'Last 30 days' },
  { value: '7d', label: 'Last 7 days' },
];

// Client-side sort. 'default' preserves the server's lifecycle-timestamp
// ordering (most recently created/completed/abandoned first).
type SortKey =
  | 'default'
  | 'title_asc'
  | 'tier_desc'
  | 'xp_desc'
  | 'deadline_soonest';

const SORT_OPTIONS: DropdownOption<SortKey>[] = [
  { value: 'default', label: 'Default', description: 'Most recent first.' },
  { value: 'title_asc', label: 'Alphabetical', description: 'Title A to Z.' },
  {
    value: 'tier_desc',
    label: 'Tier',
    description: 'Legendary down to Trivial.',
  },
  { value: 'xp_desc', label: 'XP', description: 'Biggest XP reward first.' },
  {
    value: 'deadline_soonest',
    label: 'Deadline',
    description: 'Soonest deadline first; undated last.',
  },
];

const TIER_WEIGHT: Record<QuestTier, number> = {
  trivial: 1,
  minor: 2,
  standard: 3,
  major: 4,
  legendary: 5,
};

function applySort(quests: Quest[], key: SortKey): Quest[] {
  if (key === 'default') return quests;
  const arr = [...quests];
  if (key === 'title_asc') {
    arr.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
  } else if (key === 'tier_desc') {
    arr.sort((a, b) => (TIER_WEIGHT[b.tier] ?? 0) - (TIER_WEIGHT[a.tier] ?? 0));
  } else if (key === 'xp_desc') {
    arr.sort((a, b) => (b.xp_reward ?? 0) - (a.xp_reward ?? 0));
  } else if (key === 'deadline_soonest') {
    arr.sort((a, b) => {
      // Quests with no deadline sort to the bottom.
      const ad = a.deadline ? new Date(a.deadline).getTime() : Number.POSITIVE_INFINITY;
      const bd = b.deadline ? new Date(b.deadline).getTime() : Number.POSITIVE_INFINITY;
      return ad - bd;
    });
  }
  return arr;
}

export default function QuestBoard() {
  const { subscription } = useAuth();
  const [status, setStatus] = useState<QuestStatus>('active');
  const [quests, setQuests] = useState<Quest[] | null>(null);
  const [activeQuestCount, setActiveQuestCount] = useState<number | null>(null);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Filter state. Persist across tab swaps so a user can pivot
  // "show me all 'major' tier work I did this month" without re-typing.
  const [searchText, setSearchText] = useState('');
  const [tierFilter, setTierFilter] = useState<QuestTier | 'all'>('all');
  const [factionFilter, setFactionFilter] = useState<string>('all');
  const [timeRange, setTimeRange] = useState<TimeRange>('all');
  const [sortKey, setSortKey] = useState<SortKey>('default');
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Refetch when the active tab changes — simpler than caching three lists
  // and the dataset is small enough that the round-trip is unnoticeable.
  // Also pull the active count separately so the cap indicator stays accurate
  // across tab switches (the visible list might be Completed).
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      setQuests(null);
      Promise.all([listQuests(status), listFactions(), listQuests('active')])
        .then(([rows, fx, active]) => {
          if (cancelled) return;
          setQuests(rows);
          setFactions(fx);
          setActiveQuestCount(active.length);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
      return () => {
        cancelled = true;
      };
    }, [status]),
  );

  const filters: QuestFilters = useMemo(
    () => ({
      searchText: searchText || undefined,
      tier: tierFilter,
      factionId: factionFilter,
      timeRange: status === 'active' ? 'all' : timeRange,
    }),
    [searchText, tierFilter, factionFilter, timeRange, status],
  );

  const filtered = useMemo(
    () => {
      if (!quests) return null;
      return applySort(applyQuestFilters(quests, filters), sortKey);
    },
    [quests, filters, sortKey],
  );

  const activeFilterCount =
    (searchText ? 1 : 0) +
    (tierFilter !== 'all' ? 1 : 0) +
    (factionFilter !== 'all' ? 1 : 0) +
    (status !== 'active' && timeRange !== 'all' ? 1 : 0) +
    (sortKey !== 'default' ? 1 : 0);

  const onClearFilters = () => {
    setSearchText('');
    setTierFilter('all');
    setFactionFilter('all');
    setTimeRange('all');
    setSortKey('default');
  };

  // Build the Faction dropdown options dynamically from the user's
  // factions. "All" and "Unaffiliated" are sentinel values.
  const factionFilterOptions: DropdownOption<string>[] = useMemo(
    () => [
      { value: 'all', label: 'All factions' },
      { value: 'none', label: 'Unaffiliated only' },
      ...factions.map((f) => ({ value: f.id, label: f.name })),
    ],
    [factions],
  );

  return (
    <ParchmentScreen>
      <View className="flex-1 px-6 pt-20">
      <View className="mb-4 flex-row items-center justify-between">
        <View className="flex-1">
          <Text className="font-display text-4xl text-stone-900">Quest Board</Text>
          {subscription?.tier === 'free' && activeQuestCount !== null ? (
            <Text className="mt-0.5 font-body text-lg text-stone-500">
              {activeQuestCount} / {FREE_TIER_QUEST_CAP} active · free tier
            </Text>
          ) : null}
        </View>
        <TutorialTarget id="new-quest-button">
          <Link href="/quest-board/new" asChild>
            <Pressable className="rounded-md bg-amber-600 px-3 py-2 active:bg-amber-700">
              <Text className="font-body-medium text-xl text-stone-900">+ New</Text>
            </Pressable>
          </Link>
        </TutorialTarget>
      </View>

      {/* Status tabs. mb-3 lives on an outer wrapper, not inside the
          TutorialTarget — keeps the tutorial spotlight measuring only the
          actual row of tab buttons, not the spacing below it. */}
      <View className="mb-3">
      <TutorialTarget id="quest-status-tabs">
      <View className="flex-row gap-2">
        {STATUS_TABS.map((tab) => {
          const selected = status === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                if (status !== tab.key) playSfx('tab_switch');
                setStatus(tab.key);
              }}
              className={`flex-1 rounded-md border px-2 py-2 ${
                selected
                  ? 'border-amber-600 bg-amber-900/40'
                  : 'border-stone-800 bg-amber-50/40 active:bg-amber-100/60'
              }`}
            >
              <Text
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
                className={`text-center font-body-medium text-lg uppercase tracking-widest ${
                  selected ? 'text-amber-800' : 'text-stone-700'
                }`}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      </TutorialTarget>
      </View>

      {/* Search + filters toggle */}
      <View className="mb-3 flex-row gap-2">
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search title or description"
          placeholderTextColor="#57534e"
          className="flex-1 rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 font-body text-stone-900"
        />
        <Pressable
          onPress={() => setFiltersOpen((v) => !v)}
          className={`rounded-md border px-3 py-2 active:bg-amber-100/60 ${
            activeFilterCount > 0 ? 'border-amber-600 bg-amber-900/30' : 'border-stone-700 bg-amber-50/40'
          }`}
        >
          <Text
            className={`font-body-medium text-xl ${
              activeFilterCount > 0 ? 'text-amber-800' : 'text-stone-700'
            }`}
          >
            Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ''}
          </Text>
        </Pressable>
      </View>

      {filtersOpen ? (
        <View className="mb-3 rounded-md border border-stone-800 bg-amber-50/60 p-3">
          <DropdownPicker
            label="Tier"
            value={tierFilter}
            onChange={setTierFilter}
            options={TIER_FILTER_OPTIONS}
          />
          <DropdownPicker
            label="Faction"
            value={factionFilter}
            onChange={setFactionFilter}
            options={factionFilterOptions}
          />
          {status !== 'active' ? (
            <DropdownPicker
              label="Time range"
              value={timeRange}
              onChange={setTimeRange}
              options={TIME_RANGE_OPTIONS}
            />
          ) : null}
          <DropdownPicker
            label="Sort by"
            value={sortKey}
            onChange={setSortKey}
            options={SORT_OPTIONS}
          />
          {activeFilterCount > 0 ? (
            <Pressable
              onPress={onClearFilters}
              className="mt-1 self-end px-2 py-1 active:opacity-60"
            >
              <Text className="font-body text-lg text-amber-800">Clear filters</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {error ? (
        <Text className="mb-4 font-body text-xl text-red-700">{error}</Text>
      ) : quests === null || filtered === null ? (
        <ActivityIndicator className="mt-8" color="#a8a29e" />
      ) : filtered.length === 0 ? (
        <View className="mt-8 items-center">
          <Text className="font-body text-stone-700">
            {quests.length === 0 ? emptyCopyForStatus(status) : 'No quests match those filters.'}
          </Text>
          {quests.length === 0 && status === 'active' ? (
            <Text className="mt-1 font-body text-stone-500">Forge one with the + button.</Text>
          ) : null}
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(q) => q.id}
          ItemSeparatorComponent={() => <View className="h-3" />}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => <QuestRow quest={item} status={status} />}
        />
      )}
      </View>
    </ParchmentScreen>
  );
}

function emptyCopyForStatus(status: QuestStatus): string {
  switch (status) {
    case 'active':
      return 'No active quests.';
    case 'completed':
      return 'No completed quests yet.';
    case 'abandoned':
      return 'Nothing has been abandoned. Yet.';
  }
}

function QuestRow({ quest, status }: { quest: Quest; status: QuestStatus }) {
  const urgency = deadlineUrgency(quest.deadline);
  const palette = urgency ? urgencyClasses[urgency] : urgencyClasses.normal;
  const relative = urgency ? formatDeadlineRelative(quest.deadline) : null;
  const cooldownLabel = recurrenceStatusLabel(
    quest.recurrence,
    quest.last_completed_at,
    new Date(),
    quest.recurrence_interval,
    quest.recurrence_unit,
  );

  // Build the meta line piece-by-piece so we can dedupe when classification
  // and recurrence say the same thing (e.g. classification='daily' +
  // recurrence='daily').
  const metaParts: string[] = [];
  if (quest.recurrence !== quest.classification) metaParts.push(quest.classification);
  if (quest.recurrence) {
    metaParts.push(
      quest.recurrence === 'daily'
        ? 'Daily'
        : quest.recurrence === 'weekly'
          ? 'Weekly'
          : quest.recurrence === 'monthly'
            ? 'Monthly'
            : quest.recurrence === 'yearly'
              ? 'Yearly'
              : `Every ${quest.recurrence_interval} ${quest.recurrence_unit}`,
    );
    if (quest.streak_count > 0) {
      // Streak suffix: short letter for the cadence (d/w/m/y) or generic
      // "streak" for custom. Keeps the meta row compact.
      const streakSuffix =
        quest.recurrence === 'daily'
          ? 'd'
          : quest.recurrence === 'weekly'
            ? 'w'
            : quest.recurrence === 'monthly'
              ? 'mo'
              : quest.recurrence === 'yearly'
                ? 'y'
                : '';
      metaParts.push(
        streakSuffix
          ? `${quest.streak_count}${streakSuffix} streak`
          : `${quest.streak_count} streak`,
      );
    }
  }
  const metaLine = metaParts.join(' · ');

  // Lifecycle line — only meaningful for past quests; gives the user a
  // concrete "when" to anchor the entry.
  const lifecycleLine =
    status === 'completed' && quest.completed_at
      ? `Completed ${shortDate(quest.completed_at)}`
      : status === 'abandoned' && quest.abandoned_at
        ? `Abandoned ${shortDate(quest.abandoned_at)}`
        : null;

  return (
    <Link href={{ pathname: '/quest-board/[id]', params: { id: quest.id } }} asChild>
      <Pressable
        className={`rounded-md border bg-amber-50/40 p-4 active:bg-amber-100/60 ${palette.border}`}
      >
        <View className="flex-row items-start justify-between">
          <Text
            className="flex-1 font-display text-2xl leading-7 text-stone-900"
            numberOfLines={2}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
          >
            {quest.title}
          </Text>
          <Text className="ml-3 mt-1 font-display text-lg uppercase tracking-widest text-amber-800">
            {quest.tier}
          </Text>
        </View>
        <View className="mt-1 flex-row items-center justify-between">
          <Text className="font-display text-lg uppercase tracking-widest text-stone-700">
            {metaLine}
          </Text>
          <Text className="font-body text-lg text-stone-700">{quest.xp_reward} XP</Text>
        </View>
        {lifecycleLine ? (
          <Text className="mt-2 font-body text-lg text-stone-500">{lifecycleLine}</Text>
        ) : cooldownLabel ? (
          <Text className="mt-2 font-body text-xl text-stone-500">{cooldownLabel}</Text>
        ) : relative ? (
          <Text className={`mt-2 font-body text-xl ${palette.text}`}>{relative}</Text>
        ) : null}
      </Pressable>
    </Link>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
