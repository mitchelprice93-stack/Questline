import { useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '../../lib/auth';
import { getAudioMuted } from '../../lib/audio-prefs';

// Two clips: the narrated intro plays once, then we hand off to a separate
// holding loop authored to seam back to itself with only ambient (wind +
// candle) audio. We keep a single player and `replace()` the source on
// handoff, that way the original user-gesture clearance carries over and
// browsers don't re-block autoplay on the second clip.
const INTRO_VIDEO = require('../../assets/cinematic/intro.mp4');
const HOLDING_VIDEO = require('../../assets/cinematic/holding.mp4');
const SKIP_DELAY_MS = 3_000; // spec: skippable after 3 seconds

type Phase = 'idle' | 'intro' | 'loop';

export default function Cinematic() {
  const router = useRouter();
  const { markCinematicSeen, markCinematicSeenOnDevice, profile, session } = useAuth();
  // Lift the bottom-anchored Skip and "Begin your chronicle" buttons above
  // the Android nav bar / iOS home indicator. bottom-10 (40px) base + inset
  // keeps the existing visual rhythm on gesture-nav devices while clearing
  // the system buttons on 3-button-nav devices.
  const insets = useSafeAreaInsets();
  const bottomOffset = 40 + insets.bottom;

  // 'idle' = pre-tap (web autoplay-with-audio is blocked without a user
  // gesture). 'intro' = narrated video playing through. 'loop' = ambient
  // holding video looping while the user reads "Begin your chronicle".
  const [phase, setPhase] = useState<Phase>('idle');
  const [skipVisible, setSkipVisible] = useState(false);

  const player = useVideoPlayer(INTRO_VIDEO, (p) => {
    p.loop = false;
    // Don't autoplay, we play() inside the tap handler so the browser sees
    // a user gesture and unblocks audio playback.
  });

  // Honor the persisted mute pref on mount. We read once; toggling from
  // Settings while the cinematic plays is rare enough we don't subscribe.
  useEffect(() => {
    void getAudioMuted().then((m) => {
      player.muted = m;
    });
  }, [player]);

  // Surface playback errors and status transitions to the console so we have
  // something to grep when a frozen-frame report comes in.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status, error }) => {
      if (error) console.warn('[cinematic] player error', error);
      else console.log('[cinematic] player status', status);
    });
    return () => sub.remove();
  }, [player]);

  // Reveal Skip after the spec's 3-second grace window. Timer starts when the
  // intro begins playing, not on mount.
  useEffect(() => {
    if (phase !== 'intro') return;
    const t = setTimeout(() => setSkipVisible(true), SKIP_DELAY_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // When the narrated intro reaches its end, swap the source to the holding
  // clip and turn on native looping. Same player instance, keeps the user
  // gesture clearance the browser granted on the initial tap.
  useEffect(() => {
    const sub = player.addListener('playToEnd', () => {
      // With loop=true the player will repeat without firing playToEnd again,
      // so this listener naturally fires only once per session.
      player.replace(HOLDING_VIDEO);
      player.loop = true;
      player.play();
      setPhase('loop');
    });
    return () => sub.remove();
  }, [player]);

  const onStart = () => {
    player.play();
    setPhase('intro');
  };

  const onContinue = async () => {
    // Always mark the device-level flag so the pre-auth cinematic doesn't
    // replay on next launch regardless of whether the visitor signs up.
    await markCinematicSeenOnDevice();
    if (!session) {
      // Pre-auth visitor, they've had their emotional buy-in moment.
      // Send them to the login screen to make the commitment.
      router.replace('/login');
      return;
    }
    // Signed-in case: mark the per-user flag too so Settings → Replay
    // still controls whether the cinematic replays for THIS account.
    await markCinematicSeen();
    // Replay case: user already has a character, send them home.
    router.replace(profile?.character_name ? '/quest-board' : '/character-creation');
  };

  return (
    <View className="flex-1 items-center justify-center overflow-hidden bg-stone-950">
      <VideoView
        player={player}
        style={StyleSheet.absoluteFillObject}
        // `contain` shows the full video frame and letterboxes (small black
        // bars) when the phone's aspect ratio differs from the video's. We
        // avoid `cover` here because it crops overflow on tall phones
        // (19.5:9 / 20:9), which made the intro appear zoomed in.
        contentFit="contain"
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
        <Animated.View
          entering={FadeIn.duration(400)}
          className="absolute right-6"
          style={{ bottom: bottomOffset }}
        >
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
          className="absolute left-6 right-6"
          style={{ bottom: bottomOffset }}
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
