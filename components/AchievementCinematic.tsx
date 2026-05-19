// Full-screen takeover for legendary-tier achievements.
//
// Mounted by AchievementSurface, only one at a time, blocks until the user
// taps Continue. Sequenced fade-in mirrors the LevelUpTakeover pattern from
// app/(main)/quest-board/[id].tsx so the two moments feel like siblings.
//
// Voiceover hookup is deliberately absent: Phase 3.4 voice clips are not
// generated for v1.1 achievements yet. When they exist, drop a playSfx /
// track-player call into the mount effect alongside the sting.

import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { EarnedAchievement } from '../lib/achievement-feed';
import { renderFlavor } from '../lib/engine/achievements';

interface Props {
  earned: EarnedAchievement;
  onContinue: () => void;
}

export function AchievementCinematic({ earned, onContinue }: Props) {
  const stagger = (n: number) => FadeInDown.delay(300 + n * 350).duration(700);

  // Pulsing glow behind the title, gives the takeover a "candle flicker"
  // beat while the user reads. Loops indefinitely; cleared on unmount.
  const pulse = useSharedValue(0.25);
  useEffect(() => {
    pulse.value = withDelay(
      400,
      withRepeat(
        withSequence(
          withTiming(0.6, { duration: 1400 }),
          withTiming(0.25, { duration: 1400 }),
        ),
        -1,
        true,
      ),
    );
  }, [pulse]);

  const haloStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const { achievement } = earned;
  const flavor = renderFlavor(achievement, earned.metadata);

  return (
    <Animated.View
      entering={FadeIn.duration(420)}
      exiting={FadeOut.duration(260)}
      className="absolute inset-0 items-center justify-center bg-stone-950 px-6"
    >
      <Animated.View
        pointerEvents="none"
        className="absolute inset-0 bg-amber-700"
        style={haloStyle}
      />
      <Animated.View entering={stagger(0)}>
        <Text className="mb-3 text-center font-display text-base uppercase tracking-[0.5em] text-amber-300">
          A legend in ink
        </Text>
      </Animated.View>
      <Animated.View entering={stagger(1)}>
        <Text className="mb-4 text-center font-display-bold text-4xl text-amber-50">
          {achievement.name}
        </Text>
      </Animated.View>
      <Animated.View entering={stagger(2)}>
        <Text className="mb-10 max-w-md text-center font-body text-xl text-stone-200">
          {flavor}
        </Text>
      </Animated.View>
      <Animated.View entering={stagger(3)}>
        <Pressable
          onPress={onContinue}
          className="rounded-md border border-amber-500 bg-amber-700 px-8 py-3 active:bg-amber-800"
        >
          <Text className="font-display text-lg uppercase tracking-[0.3em] text-amber-50">
            Continue
          </Text>
        </Pressable>
      </Animated.View>
      <View className="h-12" />
    </Animated.View>
  );
}
