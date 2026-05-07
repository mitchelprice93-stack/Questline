// Cross-screen audio preferences. Currently a single mute toggle that the
// cinematic player honors; future surfaces (ambient, voiceover) will read
// from the same store.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

const KEY_MUTED = 'questline.audio.muted';

export async function getAudioMuted(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY_MUTED)) === '1';
  } catch {
    return false;
  }
}

export async function setAudioMuted(muted: boolean): Promise<void> {
  await AsyncStorage.setItem(KEY_MUTED, muted ? '1' : '0');
}

/** Hook: returns [muted, setter]. The setter persists and updates state. */
export function useAudioMuted(): [boolean, (m: boolean) => Promise<void>] {
  const [muted, setMutedState] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getAudioMuted().then((m) => {
      if (!cancelled) setMutedState(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const set = async (m: boolean) => {
    await setAudioMuted(m);
    setMutedState(m);
  };
  return [muted, set];
}
