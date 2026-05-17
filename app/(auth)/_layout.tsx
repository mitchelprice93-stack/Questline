import { Stack } from 'expo-router';
import { View } from 'react-native';

import { AmbientAudioRoot } from '../../lib/ambient-audio';

export default function AuthLayout() {
  return (
    <View className="flex-1">
      {/* Ambient music bed for the signed-out flow (login + signup).
          The (main) layout mounts its own AmbientAudioRoot once the user
          signs in; both respect the audio-mute pref, so the toggle works
          across the whole app. */}
      <AmbientAudioRoot />
      <Stack screenOptions={{ headerShown: false }} />
    </View>
  );
}
