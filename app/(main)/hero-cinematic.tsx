import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { playSfx } from '../../lib/sfx';

/**
 * Plays after a successful Hero purchase. Dark backdrop + Cinzel display
 * staggered in. ElevenLabs voice slot deferred until 3.4 lands — text-only
 * for now.
 *
 * Reachable via router.replace('/hero-cinematic') from the paywall on
 * purchase / restore success. The user dismisses with "Continue your
 * chronicle" and lands back on the Quest Board.
 */
export default function HeroCinematic() {
  const router = useRouter();
  const stagger = (n: number) => FadeInDown.delay(400 + n * 500).duration(900);

  useEffect(() => {
    // Coin-clink → soft horn already covered by hero_pledge SFX. We fire it
    // again here in case the user lands cold (e.g., webhook-driven state
    // change while paywall was already dismissed).
    playSfx('hero_pledge');
  }, []);

  return (
    <View className="flex-1 items-center justify-center bg-stone-950 px-6">
      <Animated.View entering={FadeIn.duration(600)} className="absolute inset-0 bg-amber-950/15" />

      <Animated.View entering={stagger(0)}>
        <Text className="mb-2 text-center font-display text-xs uppercase tracking-[0.4em] text-amber-400">
          The pledge is taken
        </Text>
      </Animated.View>

      <Animated.View entering={stagger(1)}>
        <Text className="mb-8 text-center font-display-bold text-5xl text-stone-100">
          HERO
        </Text>
      </Animated.View>

      <Animated.View entering={stagger(2)} className="mb-10 max-w-md">
        <Text className="text-center font-body italic text-xl leading-relaxed text-stone-200">
          “Coin to the dish, ink to the page. The Tome opens fully to you, chronicler. Inscribe
          without ceiling, and let your chronicle thicken as it will.”
        </Text>
      </Animated.View>

      <Animated.View entering={stagger(3)} className="mb-10">
        <Text className="text-center font-body text-base text-stone-500">
          Your contribution sustains the Archivist&apos;s work. The Tome remembers.
        </Text>
      </Animated.View>

      <Animated.View entering={stagger(4)} className="w-full max-w-md">
        <Pressable
          onPress={() => router.replace('/quest-board')}
          className="rounded-md bg-amber-600 px-4 py-4 active:bg-amber-700"
        >
          <Text className="text-center font-display text-2xl text-stone-100">
            Continue your chronicle
          </Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}
