import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { abandonQuest, completeQuest, getQuest } from '../../../lib/quests';
import type { Quest } from '../../../lib/types/models';

export default function QuestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [quest, setQuest] = useState<Quest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'complete' | 'abandon' | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getQuest(id)
      .then((q) => {
        if (!cancelled) setQuest(q);
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const onComplete = async () => {
    if (!quest) return;
    setBusy('complete');
    setActionError(null);
    try {
      const result = await completeQuest(quest.id);
      Alert.alert('Quest completed', `+${result.xpChange} XP earned · ${result.newTotalXp} total`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const onAbandon = () => {
    if (!quest) return;
    Alert.alert('Abandon quest?', 'No XP will be granted. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Abandon',
        style: 'destructive',
        onPress: async () => {
          setBusy('abandon');
          setActionError(null);
          try {
            await abandonQuest(quest.id);
            router.back();
          } catch (e) {
            setActionError(e instanceof Error ? e.message : String(e));
            setBusy(null);
          }
        },
      },
    ]);
  };

  if (loadError) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-950 px-6">
        <Text className="text-red-400">{loadError}</Text>
      </View>
    );
  }
  if (!quest) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-950">
        <ActivityIndicator color="#a8a29e" />
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-stone-950" contentContainerClassName="px-6 pt-16 pb-12">
      <Text className="mb-1 text-3xl text-stone-100">{quest.title}</Text>
      <View className="mb-6 flex-row gap-3">
        <Text className="text-xs uppercase text-amber-400">{quest.tier}</Text>
        <Text className="text-xs text-stone-500">·</Text>
        <Text className="text-xs text-stone-400">{quest.classification}</Text>
        <Text className="text-xs text-stone-500">·</Text>
        <Text className="text-xs text-stone-400">{quest.xp_reward} XP</Text>
      </View>

      {quest.description ? (
        <Text className="mb-6 text-stone-300">{quest.description}</Text>
      ) : (
        <Text className="mb-6 text-stone-500">No description.</Text>
      )}

      {quest.deadline ? (
        <View className="mb-6">
          <Text className="text-xs text-stone-500">Deadline</Text>
          <Text className="text-stone-300">{quest.deadline}</Text>
        </View>
      ) : null}

      {quest.objectives.length > 0 ? (
        <View className="mb-6">
          <Text className="mb-2 text-xs text-stone-500">Objectives</Text>
          {quest.objectives.map((obj, idx) => (
            <Text key={idx} className="text-stone-300">
              {obj.completed ? '☑ ' : '☐ '}
              {obj.text}
            </Text>
          ))}
        </View>
      ) : null}

      {actionError ? <Text className="mb-4 text-sm text-red-400">{actionError}</Text> : null}

      <Pressable
        onPress={onComplete}
        disabled={busy !== null}
        className={`mb-3 rounded-md px-4 py-3 ${busy ? 'bg-stone-800' : 'bg-amber-600 active:bg-amber-700'}`}
      >
        <Text className="text-center text-base font-medium text-stone-100">
          {busy === 'complete' ? 'Completing…' : 'Mark complete'}
        </Text>
      </Pressable>

      <Pressable
        onPress={onAbandon}
        disabled={busy !== null}
        className="rounded-md border border-stone-700 bg-stone-900 px-4 py-3 active:bg-stone-800"
      >
        <Text className="text-center text-base text-stone-300">
          {busy === 'abandon' ? 'Abandoning…' : 'Abandon quest'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
