import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';

import { useAuth } from '../../lib/auth';
import { calculateLevel } from '../../lib/engine/xp';
import {
  getActiveQuestCount,
  getCurrentProfile,
  listCampaigns,
  listFactions,
} from '../../lib/profile';
import type { Campaign, Faction, Profile } from '../../lib/types/models';

interface SheetData {
  profile: Profile | null;
  factions: Faction[];
  campaigns: Campaign[];
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
      Promise.all([
        getCurrentProfile(),
        listFactions(),
        listCampaigns('active'),
        getActiveQuestCount(),
      ])
        .then(([profile, factions, campaigns, activeQuests]) => {
          if (!cancelled) setData({ profile, factions, campaigns, activeQuests });
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
        <Text className="font-body text-red-400">{error}</Text>
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

  const { profile, factions, campaigns, activeQuests } = data;
  const totalXp = profile?.total_xp ?? 0;
  const { level, currentLevelXp, nextLevelXp } = calculateLevel(totalXp);
  const atMaxLevel = nextLevelXp === 0;
  const progressPct = atMaxLevel ? 100 : Math.round((currentLevelXp / nextLevelXp) * 100);

  const displayName =
    profile?.character_name ?? profile?.display_name ?? session?.user.email ?? 'Wanderer';

  return (
    <ScrollView className="flex-1 bg-stone-950" contentContainerClassName="px-6 pt-16 pb-12">
      <Text className="mb-1 font-display text-3xl text-stone-100">{displayName}</Text>
      {profile?.character_title ? (
        <Text className="mb-6 font-display text-amber-300">{profile.character_title}</Text>
      ) : (
        <Text className="mb-6 font-body italic text-stone-500">Untitled, for now.</Text>
      )}

      {/* Level + XP bar */}
      <View className="mb-8 rounded-md border border-stone-800 bg-stone-900 p-4">
        <View className="mb-2 flex-row items-baseline justify-between">
          <Text className="font-display text-xs uppercase tracking-widest text-stone-400">
            Level
          </Text>
          <Text className="font-display-bold text-2xl text-stone-100">{level}</Text>
        </View>
        <View className="mb-1 h-2 overflow-hidden rounded-full bg-stone-800">
          <View className="h-2 rounded-full bg-amber-500" style={{ width: `${progressPct}%` }} />
        </View>
        <Text className="font-body text-xs text-stone-500">
          {atMaxLevel
            ? `${totalXp.toLocaleString()} XP · max level reached`
            : `${currentLevelXp.toLocaleString()} / ${nextLevelXp.toLocaleString()} XP into this level · ${totalXp.toLocaleString()} total`}
        </Text>
      </View>

      {/* Active quests */}
      <View className="mb-8 rounded-md border border-stone-800 bg-stone-900 p-4">
        <Text className="mb-1 font-display text-xs uppercase tracking-widest text-stone-400">
          Active quests
        </Text>
        <Text className="font-display-bold text-2xl text-stone-100">{activeQuests}</Text>
      </View>

      {/* Factions */}
      <Text className="mb-2 font-display text-xs uppercase tracking-widest text-stone-300">
        Factions
      </Text>
      {factions.length === 0 ? (
        <Text className="mb-8 font-body italic text-stone-500">
          The Archivist will inscribe these during character creation.
        </Text>
      ) : (
        <View className="mb-8 gap-2">
          {factions.map((f) => (
            <View key={f.id} className="rounded-md border border-stone-800 bg-stone-900 px-4 py-3">
              <Text className="font-body-medium text-base text-stone-100">{f.name}</Text>
              <Text className="font-body text-xs text-stone-500">{f.real_world_domain}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Campaigns — long-term arcs you set during character creation. Quests
          on the Quest Board are individual steps toward these. */}
      <Text className="mb-2 font-display text-xs uppercase tracking-widest text-stone-300">
        Campaigns
      </Text>
      {campaigns.length === 0 ? (
        <Text className="mb-8 font-body italic text-stone-500">
          No active arcs. Forge new ones as your chronicle unfolds.
        </Text>
      ) : (
        <View className="mb-8 gap-2">
          {campaigns.map((c) => (
            <View key={c.id} className="rounded-md border border-stone-800 bg-stone-900 px-4 py-3">
              <Text className="font-body-medium text-base text-stone-100">{c.arc_name}</Text>
              <Text className="font-body text-xs text-stone-500">{c.real_world_goal}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Difficulty */}
      <Text className="mb-2 font-display text-xs uppercase tracking-widest text-stone-300">
        Difficulty
      </Text>
      <Text className="font-body capitalize text-stone-100">{profile?.difficulty ?? 'adept'}</Text>
    </ScrollView>
  );
}
