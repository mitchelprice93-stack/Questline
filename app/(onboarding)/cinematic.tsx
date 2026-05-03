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

type Phase = 'idle' | 'intro' | 'loop';

export default function Cinematic() {
  const router = useRouter();
  const { markCinematicSeen, profile } = useAuth();

  // 'idle' = pre-tap (web autoplay-with-audio is blocked without a user
  // gesture, so we wait for the first tap). 'intro' = video playing through.
  // 'loop' = video has hit its end and is looping the ambient region.
  const [phase, setPhase] = useState<Phase>('idle');
  const [skipVisible, setSkipVisible] = useState(false);

  const player = useVideoPlayer(VIDEO, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.1; // 100ms — tight enough to catch LOOP_END
    // Intentionally NOT calling p.play() here. Browsers reject autoplay with
    // audio outside a user gesture, which leaves the video frozen on frame 1.
    // We start playback in the tap handler instead.
  });

  // Surface playback errors and status transitions to the console so we have
  // something to grep when a frozen-frame report comes in.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status, error }) => {
      if (error) console.warn('[cinematic] player error', error);
      else console.log('[cinematic] status', status);
    });
    return () => sub.remove();
  }, [player]);

  // Reveal Skip after the spec's 3-second grace window. Timer starts when the
  // intro begins playing, not on mount — there's no point letting the user
  // skip a video that hasn't started yet.
  useEffect(() => {
    if (phase !== 'intro') return;
    const t = setTimeout(() => setSkipVisible(true), SKIP_DELAY_MS);
    return () => clearTimeout(t);
  }, [phase]);

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

  const onStart = () => {
    player.play();
    setPhase('intro');
  };

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

      {/* Pre-tap gate. Required for web autoplay-with-audio; harmless on
          native (the user just taps once to start the show). */}
      {phase === 'idle' ? (
        <Pressable
          onPress={onStart}
          className="absolute inset-0 items-center justify-center bg-stone-950/40"
        >
          <Animated.View entering={FadeIn.duration(600)}>
            <Text className="font-display text-2xl uppercase tracking-[0.4em] text-stone-100">
              Begin
            </Text>
            <Text className="mt-2 text-center font-body text-sm text-stone-300">
              tap to start
            </Text>
          </Animated.View>
        </Pressable>
      ) : null}

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
