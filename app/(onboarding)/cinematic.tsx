import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useAuth } from '../../lib/auth';

// The intro video carries its own narration and ambient track. The 21.0–21.43s
// region is a near-still desk shot with only wind + candle audio, ideal for an
// idle loop while the user decides to begin.
const VIDEO = require('../../assets/cinematic/intro.mp4');
const LOOP_START = 21.0;
const LOOP_END = 21.43;
const SKIP_DELAY_MS = 3_000; // spec: skippable after 3 seconds

export default function Cinematic() {
  const router = useRouter();
  const { markCinematicSeen, profile } = useAuth();

  const [phase, setPhase] = useState<'intro' | 'loop'>('intro');
  const [skipVisible, setSkipVisible] = useState(false);

  const player = useVideoPlayer(VIDEO, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.1; // 100ms — tight enough to catch LOOP_END
    p.play();
  });

  // Reveal Skip after the spec's 3-second grace window.
  useEffect(() => {
    const t = setTimeout(() => setSkipVisible(true), SKIP_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  // When the intro reaches its end, jump back to the ambient loop window and
  // surface the Begin button. After this point the video stays in [LOOP_START,
  // LOOP_END] until the user taps Begin.
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => {
      player.currentTime = LOOP_START;
      player.play();
      setPhase('loop');
    });
    return () => sub.remove();
  }, [player]);

  // Snap back to LOOP_START whenever playback crosses LOOP_END, but only once
  // we're in the loop phase — the intro plays through unchanged.
  useEffect(() => {
    if (phase !== 'loop') return;
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (currentTime >= LOOP_END) {
        player.currentTime = LOOP_START;
      }
    });
    return () => sub.remove();
  }, [player, phase]);

  const onContinue = async () => {
    await markCinematicSeen();
    // Replay case: user already has a character, send them home.
    router.replace(profile?.character_name ? '/quest-board' : '/character-creation');
  };

  return (
    <View className="flex-1 items-center justify-center overflow-hidden bg-stone-950">
      <VideoView
        player={player}
        style={StyleSheet.absoluteFillObject}
        contentFit="cover"
        nativeControls={false}
        pointerEvents="none"
      />

      {/* Skip floats bottom-right during the intro only. Once we're looping the
          ambient region the Begin button takes over. */}
      {skipVisible && phase === 'intro' ? (
        <Animated.View entering={FadeIn.duration(400)} className="absolute bottom-10 right-6">
          <Pressable onPress={onContinue} className="px-3 py-2 active:opacity-60">
            <Text className="font-display text-xs uppercase tracking-[0.4em] text-stone-300">
              Skip
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}

      {phase === 'loop' ? (
        <Animated.View
          entering={FadeIn.duration(700).delay(200)}
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
