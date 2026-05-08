// Ambient music loop. Mounted once at the (main) layout root. Reads the
// existing audio-mute pref so the Settings toggle controls cinematic +
// SFX + ambient with one switch.
//
// Uses expo-audio (the purpose-built audio player) rather than expo-video
// because the mp3 may carry embedded album art / ID3 tags that make
// expo-video unhappy treating the file as video. expo-audio handles
// audio-only sources natively.

import { useAudioPlayer } from 'expo-audio';
import { useEffect } from 'react';

import { useAudioMuted } from './audio-prefs';

const AMBIENT_SOURCE = require('../assets/audio/ambient-loop.mp3');

/**
 * Mount this once near the (main) layout root. Plays the ambient bed at
 * 35% volume on a seamless loop. Respects the audio-mute pref. Renders
 * nothing — the player is purely audio.
 */
export function AmbientAudioRoot() {
  const player = useAudioPlayer(AMBIENT_SOURCE);
  const [muted] = useAudioMuted();

  useEffect(() => {
    // Configure once on mount. expo-audio's player has stable identity per
    // source, so setting these on every render is wasteful — bind in a
    // mount effect instead.
    player.loop = true;
    player.volume = 0.35;
  }, [player]);

  useEffect(() => {
    if (muted) {
      player.pause();
      player.muted = true;
    } else {
      player.muted = false;
      // Browsers and iOS will silently reject play() until a user gesture
      // has unblocked the audio context. By the time the user reaches the
      // (main) layout they've definitely tapped through onboarding /
      // cinematic, so this should always be a clear path.
      try {
        player.play();
      } catch (e) {
        console.warn('[ambient] play failed', e);
      }
    }
  }, [player, muted]);

  return null;
}
