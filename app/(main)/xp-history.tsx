import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';

import { errorMessage } from '../../lib/errors';
import { ParchmentScreen } from '../../lib/parchment';
import { describeXpLogReason, listXpLog, type XpLogEntry } from '../../lib/xp-log';

export default function XpHistory() {
  const router = useRouter();
  const [rows, setRows] = useState<XpLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      setRows(null);
      listXpLog()
        .then((data) => {
          if (!cancelled) setRows(data);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(errorMessage(e));
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const total = rows?.reduce((sum, r) => sum + r.xp_change, 0) ?? 0;

  return (
    <ParchmentScreen>
      <View className="flex-1 px-6 pt-20">
      <View className="mb-2 flex-row items-baseline justify-between">
        <Text className="font-display text-4xl text-stone-900">XP History</Text>
        <Pressable onPress={() => router.back()} className="active:opacity-60">
          <Text className="font-body text-base text-amber-800">Back</Text>
        </Pressable>
      </View>
      <Text className="mb-6 font-body text-sm text-stone-500">
        Every line of XP the Tome has inscribed for you, newest first.
        {rows ? ` ${rows.length} entries · +${total.toLocaleString()} XP shown.` : ''}
      </Text>

      {error ? (
        <Text className="font-body text-base text-red-700">{error}</Text>
      ) : rows === null ? (
        <ActivityIndicator className="mt-8" color="#a8a29e" />
      ) : rows.length === 0 ? (
        <Text className="mt-8 text-center font-body italic text-stone-500">
          The Tome holds no entries yet. Complete a quest and the chronicle begins.
        </Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.id}
          ItemSeparatorComponent={() => <View className="h-2" />}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => <XpRow row={item} />}
        />
      )}
      </View>
    </ParchmentScreen>
  );
}

function XpRow({ row }: { row: XpLogEntry }) {
  const isStreak = row.reason.startsWith('streak_bonus_');
  const swatch = isStreak ? 'border-amber-700/40' : 'border-stone-800';
  const xpColor = row.xp_change >= 0 ? 'text-emerald-800' : 'text-red-700';
  const sign = row.xp_change >= 0 ? '+' : '';
  return (
    <View className={`rounded-md border ${swatch} bg-amber-50/40 px-4 py-3`}>
      <View className="flex-row items-baseline justify-between">
        <Text className="flex-1 font-body text-base text-stone-800" numberOfLines={2}>
          {describeXpLogReason(row.reason, row.quest_title)}
        </Text>
        <Text className={`ml-3 font-body-medium text-base ${xpColor}`}>
          {sign}
          {row.xp_change.toLocaleString()} XP
        </Text>
      </View>
      <Text className="mt-0.5 font-body text-sm text-stone-500">{formatRowDate(row.created_at)}</Text>
    </View>
  );
}

function formatRowDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const now = Date.now();
  const ms = now - d.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
