import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { deadlineUrgency, formatDeadlineRelative, urgencyClasses } from '../../../lib/dates';
import { listQuests } from '../../../lib/quests';
import type { Quest } from '../../../lib/types/models';

export default function QuestBoard() {
  const [quests, setQuests] = useState<Quest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      listQuests('active')
        .then((rows) => {
          if (!cancelled) setQuests(rows);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return (
    <View className="flex-1 bg-stone-950 px-6 pt-16">
      <View className="mb-6 flex-row items-center justify-between">
        <Text className="font-display text-3xl text-stone-100">Quest Board</Text>
        <Link href="/quest-board/new" asChild>
          <Pressable className="rounded-md bg-amber-600 px-3 py-2 active:bg-amber-700">
            <Text className="font-body-medium text-sm text-stone-100">+ New</Text>
          </Pressable>
        </Link>
      </View>

      {error ? (
        <Text className="mb-4 font-body text-sm text-red-400">{error}</Text>
      ) : quests === null ? (
        <ActivityIndicator className="mt-8" color="#a8a29e" />
      ) : quests.length === 0 ? (
        <View className="mt-8 items-center">
          <Text className="font-body text-stone-400">No active quests.</Text>
          <Text className="mt-1 font-body text-stone-500">Forge one with the + button.</Text>
        </View>
      ) : (
        <FlatList
          data={quests}
          keyExtractor={(q) => q.id}
          ItemSeparatorComponent={() => <View className="h-3" />}
          renderItem={({ item }) => <QuestRow quest={item} />}
        />
      )}
    </View>
  );
}

function QuestRow({ quest }: { quest: Quest }) {
  const urgency = deadlineUrgency(quest.deadline);
  const palette = urgency ? urgencyClasses[urgency] : urgencyClasses.normal;
  const relative = urgency ? formatDeadlineRelative(quest.deadline) : null;
  return (
    <Link href={{ pathname: '/quest-board/[id]', params: { id: quest.id } }} asChild>
      <Pressable
        className={`rounded-md border bg-stone-900 p-4 active:bg-stone-800 ${palette.border}`}
      >
        <View className="flex-row items-center justify-between">
          <Text className="flex-1 font-display text-base text-stone-100" numberOfLines={1}>
            {quest.title}
          </Text>
          <Text className="ml-3 font-display text-xs uppercase tracking-widest text-amber-400">
            {quest.tier}
          </Text>
        </View>
        <View className="mt-1 flex-row items-center justify-between">
          <Text className="font-display text-xs uppercase tracking-widest text-stone-400">
            {quest.classification}
          </Text>
          <Text className="font-body text-xs text-stone-300">{quest.xp_reward} XP</Text>
        </View>
        {relative ? (
          <Text className={`mt-2 font-body text-sm ${palette.text}`}>{relative}</Text>
        ) : null}
      </Pressable>
    </Link>
  );
}
