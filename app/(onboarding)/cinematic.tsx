import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { useAuth } from '../../lib/auth';

// The five narration beats. Stephen Fry voice — measured, lightly amused.
// Kept short on purpose; the cinematic should feel like a held breath, not a
// monologue.
const BEATS = [
  'And so the Tome opens once more.',
  'I am the Archivist of Fate.',
  'Lives find their measure here, day by day.',
  'Your story is yours to tell. Mine, simply, to record.',
  'Tell me, then. Who are you?',
];

const TYPE_MS = 35; // milliseconds per character revealed
const PAUSE_MS = 850; // hold after a beat fully renders before fading to next
const SKIP_DELAY_MS = 3_000; // spec: skippable after 3 seconds

export default function Cinematic() {
  const router = useRouter();
  const { markCinematicSeen } = useAuth();

  const [beatIdx, setBeatIdx] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const [done, setDone] = useState(false);
  const [skipVisible, setSkipVisible] = useState(false);

  // Type-on / advance loop.
  useEffect(() => {
    if (done) return;
    const beat = BEATS[beatIdx] ?? '';
    if (revealed < beat.length) {
      const t = setTimeout(() => setRevealed((c) => c + 1), TYPE_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => {
      if (beatIdx < BEATS.length - 1) {
        setBeatIdx((i) => i + 1);
        setRevealed(0);
      } else {
        setDone(true);
      }
    }, PAUSE_MS);
    return () => clearTimeout(t);
  }, [beatIdx, revealed, done]);

  // Reveal Skip after the spec's 3-second grace window.
  useEffect(() => {
    const t = setTimeout(() => setSkipVisible(true), SKIP_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  // Candle flicker — subtle opacity pulse on the warm glow layer.
  const flicker = useSharedValue(0.7);
  useEffect(() => {
    flicker.value = withRepeat(
      withSequence(
        withTiming(0.95, { duration: 1_400, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.62, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
  }, [flicker]);

  const flickerStyle = useAnimatedStyle(() => ({ opacity: flicker.value }));

  const onContinue = async () => {
    await markCinematicSeen();
    router.replace('/character-creation');
  };

  const currentBeat = BEATS[beatIdx] ?? '';
  const visibleText = currentBeat.slice(0, revealed);
  const isTyping = revealed < currentBeat.length;

  return (
    <View className="flex-1 items-center justify-center overflow-hidden bg-stone-950 px-6">
      {/* Layer 1 — candlelight glow (parallax stand-in until the commissioned
          5-layer parchment scene lands). */}
      <Animated.View
        pointerEvents="none"
        style={[
          flickerStyle,
          {
            position: 'absolute',
            width: 720,
            height: 720,
            borderRadius: 360,
            backgroundColor: '#92400e', // amber-800
            opacity: 0.22,
          },
        ]}
      />

      {/* Layer 2 — faint horizontal "shelves" suggesting library depth. */}
      <View className="absolute inset-x-0 inset-y-12 justify-around" pointerEvents="none">
        <View className="h-px bg-amber-900/15" />
        <View className="h-px bg-amber-900/20" />
        <View className="h-px bg-amber-900/15" />
        <View className="h-px bg-amber-900/10" />
      </View>

      {/* Layer 3 — vignette frame. */}
      <View
        className="absolute inset-0 border-[24px] border-stone-950"
        style={{
          shadowColor: '#000',
          shadowOpacity: 0.6,
          shadowRadius: 80,
        }}
        pointerEvents="none"
      />

      {/* Layer 4 — narration. Re-mounted each beat so FadeIn / FadeOut can
          run on the swap. */}
      <View className="z-10 items-center">
        <Animated.View
          key={beatIdx}
          entering={FadeIn.duration(450)}
          exiting={FadeOut.duration(300)}
        >
          <Text className="max-w-md text-center font-display text-2xl leading-relaxed text-stone-100">
            {visibleText}
            {isTyping ? <Text className="text-amber-400"> ▎</Text> : null}
          </Text>
        </Animated.View>
      </View>

      {/* Layer 5 — controls. Skip floats bottom-right; Begin appears once all
          beats have rendered. */}
      {skipVisible && !done ? (
        <Animated.View entering={FadeIn.duration(400)} className="absolute bottom-10 right-6">
          <Pressable onPress={onContinue} className="px-3 py-2 active:opacity-60">
            <Text className="font-display text-xs uppercase tracking-[0.4em] text-stone-500">
              Skip
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {done ? (
        <Animated.View
          entering={FadeIn.duration(700).delay(400)}
          className="absolute bottom-10 left-6 right-6"
        >
          <Pressable
            onPress={onContinue}
            className="rounded-md bg-amber-600 px-4 py-3 active:bg-amber-700"
          >
            <Text className="text-center font-display text-base text-stone-100">
              Begin your chronicle
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}
