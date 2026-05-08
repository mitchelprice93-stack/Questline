// Ambient music loop. Mounted once at the app root; reads the existing
// audio-mute pref so a single toggle controls cinematic + ambient.
//
// The underlying mp3 lives at assets/audio/ambient-loop.mp3 — currently
// a 5-second silent placeholder, swap it out with the commissioned track
// from prompts/parchment-ui-brief.md and no code change is needed.
//
// Re-uses expo-video (which we already have installed) to play audio-only
// content. No additional native dep needed.

import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';

import { useAudioMuted } from './audio-prefs';

const AMBIENT_SOURCE = require('../assets/audio/ambient-loop.mp3');

/**
 * Mount this once near the app root. Renders a tiny invisible VideoView
 * (expo-video requires a view element to actually play) and quietly loops
 * the ambient bed. The view has zero size and pointerEvents=none so it
 * doesn't intercept anything.
 */
export function AmbientAudioRoot() {
  const player = useVideoPlayer(AMBIENT_SOURCE, (p) => {
    p.loop = true;
    p.volume = 0.35; // sit under everything else
    // Don't autoplay — browsers block autoplay-with-audio without a user
    // gesture. The cinematic and various button taps satisfy that gate; we
    // start playback once the mute pref says we should.
  });

  const [muted] = useAudioMuted();

  useEffect(() => {
    if (muted) {
      player.pause();
      player.muted = true;
    } else {
      player.muted = false;
      // play() is idempotent — calling it on a playing player is a no-op.
      // On web it'll silently fail until a user gesture has unblocked the
      // audio context; subsequent calls succeed automatically.
      player.play();
    }
  }, [player, muted]);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { width: 0, height: 0, opacity: 0 }]}
    >
      <VideoView player={player} style={{ width: 0, height: 0 }} nativeControls={false} />
    </View>
  );
}
