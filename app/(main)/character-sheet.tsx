import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { useAuth } from '../../lib/auth';
import { calculateLevel } from '../../lib/engine/xp';
import { getActiveQuestCount, getCurrentProfile, listFactions } from '../../lib/profile';
import type { Faction, Profile } from '../../lib/types/models';

interface SheetData {
  profile: Profile | null;
  factions: Faction[];
  activeQuests: number;
}

export default function CharacterSheet() {
  const { session } = useAuth();
  const [data, setData] = useState<SheetData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      setError(null);
      Promise.all([getCurrentProfile(), listFactions(), getActiveQuestCount()])
        .then(([profile, factions, activeQuests]) => {
          if (!cancelled) setData({ profile, factions, activeQuests });
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : String(e));
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-950 px-6">
        <Text className="text-red-400">{error}</Text>
      </View>
    );
  }
  if (!data) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-950">
        <ActivityIndicator color="#a8a29e" />
      </View>
    );
  }

  const { profile, factions, activeQuests } = data;
  const totalXp = profile?.total_xp ?? 0;
  const { level, currentLevelXp, nextLevelXp } = calculateLevel(totalXp);
  const atMaxLevel = nextLevelXp === 0;
  const progressPct = atMaxLevel ? 100 : Math.round((currentLevelXp / nextLevelXp) * 100);

  const displayName =
    profile?.character_name ?? profile?.display_name ?? session?.user.email ?? 'Wanderer';

  return (
    <ScrollView className="flex-1 bg-stone-950" contentContainerClassName="px-6 pt-16 pb-12">
      <Text className="mb-1 text-3xl text-stone-100">{displayName}</Text>
      {profile?.character_title ? (
        <Text className="mb-6 text-stone-400">{profile.character_title}</Text>
      ) : (
        <Text className="mb-6 italic text-stone-500">Untitled, for now.</Text>
      )}

      {/* Level + XP bar */}
      <View className="mb-8 rounded-md border border-stone-800 bg-stone-900 p-4">
        <View className="mb-2 flex-row items-baseline justify-between">
          <Text className="text-stone-400">Level</Text>
          <Text className="text-2xl text-stone-100">{level}</Text>
        </View>
        <View className="mb-1 h-2 overflow-hidden rounded-full bg-stone-800">
          <View className="h-2 rounded-full bg-amber-500" style={{ width: `${progressPct}%` }} />
        </View>
        <Text className="text-xs text-stone-500">
          {atMaxLevel
            ? `${totalXp.toLocaleString()} XP · max level reached`
            : `${currentLevelXp.toLocaleString()} / ${nextLevelXp.toLocaleString()} XP into this level · ${totalXp.toLocaleString()} total`}
        </Text>
      </View>

      {/* Active quests */}
      <View className="mb-8 rounded-md border border-stone-800 bg-stone-900 p-4">
        <Text className="mb-1 text-stone-400">Active quests</Text>
        <Text className="text-2xl text-stone-100">{activeQuests}</Text>
      </View>

      {/* Factions */}
      <Text className="mb-2 text-sm text-stone-300">Factions</Text>
      {factions.length === 0 ? (
        <Text className="mb-8 italic text-stone-500">
          The Archivist will inscribe these during character creation (Phase 2.3).
        </Text>
      ) : (
        <View className="mb-8 gap-2">
          {factions.map((f) => (
            <View key={f.id} className="rounded-md border border-stone-800 bg-stone-900 px-4 py-3">
              <Text className="text-base text-stone-100">{f.name}</Text>
              <Text className="text-xs text-stone-500">{f.real_world_domain}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Difficulty */}
      <Text className="mb-2 text-sm text-stone-300">Difficulty</Text>
      <Text className="capitalize text-stone-100">{profile?.difficulty ?? 'adept'}</Text>
    </ScrollView>
  );
}
