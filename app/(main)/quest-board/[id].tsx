import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { useAuth } from '../../../lib/auth';
import { calculateLevel } from '../../../lib/engine/xp';
import { abandonQuest, completeQuest, getQuest, updateQuestObjectives } from '../../../lib/quests';
import type { Quest } from '../../../lib/types/models';

// react-native-web's Alert is a no-op, which strands the busy state when we
// rely on the OK button's onPress for navigation. Wrap both flows in a
// platform check: window.alert / window.confirm on web (synchronous), native
// Alert.alert on iOS/Android (resolved via callback).
function showInfoMessage(title: string, message: string): Promise<void> {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
      window.alert(`${title}\n\n${message}`);
      resolve();
    } else {
      Alert.alert(title, message, [{ text: 'OK', onPress: () => resolve() }], {
        onDismiss: () => resolve(),
      });
    }
  });
}

function confirmDestructive(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
      resolve(window.confirm(`${title}\n\n${message}`));
    } else {
      Alert.alert(title, message, [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Confirm', style: 'destructive', onPress: () => resolve(true) },
      ]);
    }
  });
}

interface LevelUpState {
  oldLevel: number;
  newLevel: number;
  newTotalXp: number;
  xpChange: number;
}

export default function QuestDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile, refetchProfile } = useAuth();
  const [quest, setQuest] = useState<Quest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'complete' | 'abandon' | null>(null);
  const [levelUp, setLevelUp] = useState<LevelUpState | null>(null);

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
      const oldLevel = profile?.level ?? 1;
      const result = await completeQuest(quest.id);
      const { level: newLevel } = calculateLevel(result.newTotalXp);
      if (newLevel > oldLevel) {
        // Phase 3.6 — level-up takeover. Refetch the profile so the character
        // sheet reflects the new level when the user dismisses.
        refetchProfile();
        setLevelUp({
          oldLevel,
          newLevel,
          newTotalXp: result.newTotalXp,
          xpChange: result.xpChange,
        });
      } else {
        await showInfoMessage(
          'Quest completed',
          `+${result.xpChange} XP earned · ${result.newTotalXp} total`,
        );
        router.back();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  const toggleObjective = async (idx: number) => {
    if (!quest) return;
    const previous = quest;
    const newObjectives = quest.objectives.map((o, i) =>
      i === idx ? { ...o, completed: !o.completed } : o,
    );
    setQuest({ ...quest, objectives: newObjectives });
    setActionError(null);
    try {
      await updateQuestObjectives(quest.id, newObjectives);
    } catch (e) {
      setQuest(previous);
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const onAbandon = async () => {
    if (!quest) return;
    const proceed = await confirmDestructive(
      'Abandon quest?',
      'No XP will be granted. This cannot be undone.',
    );
    if (!proceed) return;
    setBusy('abandon');
    setActionError(null);
    try {
      await abandonQuest(quest.id);
      router.back();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  if (levelUp) {
    return <LevelUpTakeover {...levelUp} onContinue={() => router.back()} />;
  }

  if (loadError) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-950 px-6">
        <Text className="font-body text-red-400">{loadError}</Text>
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
      <Text className="mb-1 font-display text-3xl text-stone-100">{quest.title}</Text>
      <View className="mb-6 flex-row gap-3">
        <Text className="font-display text-xs uppercase tracking-widest text-amber-400">
          {quest.tier}
        </Text>
        <Text className="font-body text-xs text-stone-500">·</Text>
        <Text className="font-body text-xs text-stone-400">{quest.classification}</Text>
        <Text className="font-body text-xs text-stone-500">·</Text>
        <Text className="font-body text-xs text-stone-400">{quest.xp_reward} XP</Text>
      </View>

      {quest.description ? (
        <Text className="mb-6 font-body text-stone-300">{quest.description}</Text>
      ) : (
        <Text className="mb-6 font-body italic text-stone-500">No description.</Text>
      )}

      {quest.deadline ? (
        <View className="mb-6">
          <Text className="font-display text-xs uppercase tracking-widest text-stone-500">
            Deadline
          </Text>
          <Text className="font-body text-stone-300">{quest.deadline}</Text>
        </View>
      ) : null}

      {quest.objectives.length > 0 ? (
        <View className="mb-6">
          <Text className="mb-2 font-display text-xs uppercase tracking-widest text-stone-500">
            Objectives
          </Text>
          {quest.objectives.map((obj, idx) => (
            <Pressable
              key={idx}
              onPress={() => toggleObjective(idx)}
              disabled={busy !== null}
              className="py-1.5 active:opacity-60"
            >
              <Text
                className={
                  obj.completed
                    ? 'font-body text-stone-500 line-through'
                    : 'font-body text-stone-300'
                }
              >
                {obj.completed ? '☑ ' : '☐ '}
                {obj.text}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {actionError ? (
        <Text className="mb-4 font-body text-sm text-red-400">{actionError}</Text>
      ) : null}

      <Pressable
        onPress={onComplete}
        disabled={busy !== null}
        className={`mb-3 rounded-md px-4 py-3 ${busy ? 'bg-stone-800' : 'bg-amber-600 active:bg-amber-700'}`}
      >
        <Text className="text-center font-display text-base text-stone-100">
          {busy === 'complete' ? 'Completing…' : 'Mark complete'}
        </Text>
      </Pressable>

      <Pressable
        onPress={onAbandon}
        disabled={busy !== null}
        className="rounded-md border border-stone-700 bg-stone-900 px-4 py-3 active:bg-stone-800"
      >
        <Text className="text-center font-body text-base text-stone-300">
          {busy === 'abandon' ? 'Abandoning…' : 'Abandon quest'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

// Phase 3.6 — full-screen takeover when a quest completion crosses a level
// threshold. Sequenced fade-in: caption → "LEVEL UP" → new level → XP delta →
// continue button. Dim background reinforces the moment.
function LevelUpTakeover({
  oldLevel,
  newLevel,
  newTotalXp,
  xpChange,
  onContinue,
}: LevelUpState & { onContinue: () => void }) {
  const stagger = (n: number) => FadeInDown.delay(300 + n * 350).duration(700);
  return (
    <View className="flex-1 items-center justify-center bg-stone-950 px-6">
      <Animated.View entering={FadeIn.duration(400)} className="absolute inset-0 bg-amber-950/10" />
      <Animated.View entering={stagger(0)}>
        <Text className="mb-2 text-center font-display text-xs uppercase tracking-[0.4em] text-amber-400">
          A new threshold
        </Text>
      </Animated.View>
      <Animated.View entering={stagger(1)}>
        <Text className="mb-6 text-center font-display-bold text-5xl text-stone-100">
          LEVEL {newLevel}
        </Text>
      </Animated.View>
      <Animated.View entering={stagger(2)}>
        <Text className="mb-2 text-center font-body text-stone-400">
          From level {oldLevel} to level {newLevel}
        </Text>
      </Animated.View>
      <Animated.View entering={stagger(3)}>
        <Text className="mb-12 text-center font-body text-stone-500">
          +{xpChange.toLocaleString()} XP · {newTotalXp.toLocaleString()} total
        </Text>
      </Animated.View>
      <Animated.View entering={stagger(4)} className="w-full">
        <Pressable
          onPress={onContinue}
          className="rounded-md bg-amber-600 px-4 py-3 active:bg-amber-700"
        >
          <Text className="text-center font-display text-base text-stone-100">
            Continue your chronicle
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
