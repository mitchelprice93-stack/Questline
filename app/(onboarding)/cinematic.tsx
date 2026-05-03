import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { useAuth } from '../../lib/auth';

// Two clips: the narrated intro plays once, then we hand off to a separate
// holding loop authored to seam back to itself with only ambient (wind +
// candle) audio. Cleaner than seeking inside one file — no decoder hitch on
// the seek-back, and the loop seam is exactly where the artist put it.
const INTRO_VIDEO = require('../../assets/cinematic/intro.mp4');
const HOLDING_VIDEO = require('../../assets/cinematic/holding.mp4');
const SKIP_DELAY_MS = 3_000; // spec: skippable after 3 seconds

type Phase = 'idle' | 'intro' | 'loop';

export default function Cinematic() {
  const router = useRouter();
  const { markCinematicSeen, profile } = useAuth();

  // 'idle' = pre-tap (web autoplay-with-audio is blocked without a user
  // gesture). 'intro' = narrated video playing through. 'loop' = ambient
  // holding video looping while the user reads "Begin your chronicle".
  const [phase, setPhase] = useState<Phase>('idle');
  const [skipVisible, setSkipVisible] = useState(false);

  const introPlayer = useVideoPlayer(INTRO_VIDEO, (p) => {
    p.loop = false;
    // Don't autoplay — see onStart for the user-gesture-driven play call.
  });

  const holdingPlayer = useVideoPlayer(HOLDING_VIDEO, (p) => {
    p.loop = true;
    p.muted = false;
    // Stays paused until the intro finishes; we start it in the playToEnd
    // handler below.
  });

  // Surface playback errors and status transitions to the console so we have
  // something to grep when a frozen-frame report comes in.
  useEffect(() => {
    const sub = introPlayer.addListener('statusChange', ({ status, error }) => {
      if (error) console.warn('[cinematic] intro error', error);
      else console.log('[cinematic] intro status', status);
    });
    return () => sub.remove();
  }, [introPlayer]);

  useEffect(() => {
    const sub = holdingPlayer.addListener('statusChange', ({ status, error }) => {
      if (error) console.warn('[cinematic] holding error', error);
      else console.log('[cinematic] holding status', status);
    });
    return () => sub.remove();
  }, [holdingPlayer]);

  // Reveal Skip after the spec's 3-second grace window. Timer starts when the
  // intro begins playing, not on mount.
  useEffect(() => {
    if (phase !== 'intro') return;
    const t = setTimeout(() => setSkipVisible(true), SKIP_DELAY_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // When the narrated intro reaches its end, kick off the holding loop and
  // surface the Begin button.
  useEffect(() => {
    const sub = introPlayer.addListener('playToEnd', () => {
      introPlayer.pause();
      holdingPlayer.play();
      setPhase('loop');
    });
    return () => sub.remove();
  }, [introPlayer, holdingPlayer]);

  const onStart = () => {
    introPlayer.play();
    setPhase('intro');
  };

  const onContinue = async () => {
    await markCinematicSeen();
    // Replay case: user already has a character, send them home.
    router.replace(profile?.character_name ? '/quest-board' : '/character-creation');
  };

  return (
    <View className="flex-1 items-center justify-center overflow-hidden bg-stone-950">
      {/* Render whichever clip is active. Hot-swapping the source on a single
          VideoView causes a brief black flash; mounting both and toggling
          opacity-style visibility is cleaner. */}
      {phase === 'loop' ? (
        <VideoView
          player={holdingPlayer}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          nativeControls={false}
          pointerEvents="none"
        />
      ) : (
        <VideoView
          player={introPlayer}
          style={StyleSheet.absoluteFillObject}
          contentFit="cover"
          nativeControls={false}
          pointerEvents="none"
        />
      )}

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
