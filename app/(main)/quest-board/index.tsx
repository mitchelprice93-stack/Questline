import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';

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

const TIER_OPTIONS: (QuestTier | 'all')[] = [
  'all',
  'trivial',
  'minor',
  'standard',
  'major',
  'legendary',
];

const TIME_RANGE_OPTIONS: { key: TimeRange; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: '30d', label: '30 days' },
  { key: '7d', label: '7 days' },
];

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
    () => (quests ? applyQuestFilters(quests, filters) : null),
    [quests, filters],
  );

  const activeFilterCount =
    (searchText ? 1 : 0) +
    (tierFilter !== 'all' ? 1 : 0) +
    (factionFilter !== 'all' ? 1 : 0) +
    (status !== 'active' && timeRange !== 'all' ? 1 : 0);

  const onClearFilters = () => {
    setSearchText('');
    setTierFilter('all');
    setFactionFilter('all');
    setTimeRange('all');
  };

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
        <Link href="/quest-board/new" asChild>
          <Pressable className="rounded-md bg-amber-600 px-3 py-2 active:bg-amber-700">
            <Text className="font-body-medium text-xl text-stone-900">+ New</Text>
          </Pressable>
        </Link>
      </View>

      {/* Status tabs */}
      <View className="mb-3 flex-row gap-2">
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
          <Text className="mb-1 font-display text-[10px] uppercase tracking-widest text-stone-500">
            Tier
          </Text>
          <View className="mb-2 flex-row flex-wrap gap-1.5">
            {TIER_OPTIONS.map((t) => (
              <FilterChip
                key={t}
                label={t === 'all' ? 'All' : t}
                selected={tierFilter === t}
                onPress={() => setTierFilter(t)}
              />
            ))}
          </View>

          <Text className="mb-1 font-display text-[10px] uppercase tracking-widest text-stone-500">
            Faction
          </Text>
          <View className="mb-2 flex-row flex-wrap gap-1.5">
            <FilterChip
              label="All"
              selected={factionFilter === 'all'}
              onPress={() => setFactionFilter('all')}
            />
            <FilterChip
              label="Unaffiliated"
              selected={factionFilter === 'none'}
              onPress={() => setFactionFilter('none')}
            />
            {factions.map((f) => (
              <FilterChip
                key={f.id}
                label={f.name}
                selected={factionFilter === f.id}
                onPress={() => setFactionFilter(f.id)}
              />
            ))}
          </View>

          {status !== 'active' ? (
            <>
              <Text className="mb-1 font-display text-[10px] uppercase tracking-widest text-stone-500">
                Time range
              </Text>
              <View className="mb-2 flex-row flex-wrap gap-1.5">
                {TIME_RANGE_OPTIONS.map((opt) => (
                  <FilterChip
                    key={opt.key}
                    label={opt.label}
                    selected={timeRange === opt.key}
                    onPress={() => setTimeRange(opt.key)}
                  />
                ))}
              </View>
            </>
          ) : null}

          {activeFilterCount > 0 ? (
            <Pressable onPress={onClearFilters} className="mt-1 self-end px-2 py-1 active:opacity-60">
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

function FilterChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full border px-2.5 py-1 ${
        selected ? 'border-amber-500 bg-amber-600/20' : 'border-stone-700 bg-amber-50/40'
      }`}
    >
      <Text
        className={`font-body-medium text-lg capitalize ${
          selected ? 'text-amber-800' : 'text-stone-700'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function QuestRow({ quest, status }: { quest: Quest; status: QuestStatus }) {
  const urgency = deadlineUrgency(quest.deadline);
  const palette = urgency ? urgencyClasses[urgency] : urgencyClasses.normal;
  const relative = urgency ? formatDeadlineRelative(quest.deadline) : null;
  const cooldownLabel = recurrenceStatusLabel(quest.recurrence, quest.last_completed_at);

  // Build the meta line piece-by-piece so we can dedupe when classification
  // and recurrence say the same thing (e.g. classification='daily' +
  // recurrence='daily').
  const metaParts: string[] = [];
  if (quest.recurrence !== quest.classification) metaParts.push(quest.classification);
  if (quest.recurrence) {
    metaParts.push(quest.recurrence === 'daily' ? 'Daily' : 'Weekly');
    if (quest.streak_count > 0) {
      metaParts.push(`${quest.streak_count}${quest.recurrence === 'daily' ? 'd' : 'w'} streak`);
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
        <View className="flex-row items-center justify-between">
          <Text className="flex-1 font-display text-2xl text-stone-900" numberOfLines={1}>
            {quest.title}
          </Text>
          <Text className="ml-3 font-display text-lg uppercase tracking-widest text-amber-800">
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
