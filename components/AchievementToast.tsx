// Floating toast for newly-earned achievements (common / uncommon / rare).
//
// The AchievementSurface mounts at most one of these at a time and removes
// it after AUTO_DISMISS_MS — see AchievementSurface for the queue logic.
// This component just renders + animates one card.

import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  FadeInUp,
  FadeOutUp,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { EarnedAchievement } from '../lib/achievement-feed';
import { renderFlavor, type AchievementTier } from '../lib/engine/achievements';

export const AUTO_DISMISS_MS = 4000;

interface Props {
  earned: EarnedAchievement;
  onDismiss: () => void;
}

const TIER_ACCENT: Record<AchievementTier, string> = {
  common: 'border-stone-700',
  uncommon: 'border-emerald-800',
  rare: 'border-amber-600',
  // Legendary uses the AchievementCinematic, but include the colour for
  // completeness in case a tier ever gets re-routed.
  legendary: 'border-amber-400',
};

const TIER_EYEBROW: Record<AchievementTier, string> = {
  common: 'A small inscription',
  uncommon: 'The Tome takes notice',
  rare: 'A deed of weight',
  legendary: 'A legend in ink',
};

export function AchievementToast({ earned, onDismiss }: Props) {
  const glow = useSharedValue(0);

  useEffect(() => {
    glow.value = withDelay(
      120,
      withSequence(
        withTiming(0.55, { duration: 240 }),
        withTiming(0, { duration: 520 }),
      ),
    );
  }, [glow]);

  useEffect(() => {
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  const { achievement } = earned;
  const accent = TIER_ACCENT[achievement.tier] ?? 'border-stone-700';
  const eyebrow = TIER_EYEBROW[achievement.tier] ?? 'Achievement earned';
  const flavor = renderFlavor(achievement, earned.metadata);

  return (
    <Animated.View
      entering={FadeInUp.duration(360).springify().damping(15)}
      exiting={FadeOutUp.duration(220)}
      className="px-4 pt-12"
      pointerEvents="box-none"
    >
      <Pressable onPress={onDismiss}>
        <View
          className={`overflow-hidden rounded-md border-2 bg-amber-50 px-4 py-3 shadow-lg ${accent}`}
        >
          <Animated.View
            pointerEvents="none"
            className="absolute inset-0 bg-amber-400"
            style={glowStyle}
          />
          <Text className="font-display text-xs uppercase tracking-[0.3em] text-amber-800">
            {eyebrow}
          </Text>
          <Text className="mt-0.5 font-display-bold text-xl text-stone-900">
            {achievement.name}
          </Text>
          <Text className="mt-1 font-body text-base text-stone-700">{flavor}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
