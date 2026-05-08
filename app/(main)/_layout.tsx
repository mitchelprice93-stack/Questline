import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { AmbientAudioRoot } from '../../lib/ambient-audio';
import { playSfx } from '../../lib/sfx';

export default function MainLayout() {
  return (
    <View className="flex-1">
      {/* Ambient music bed — only mounts inside the main app, not during
          the cinematic or onboarding (which have their own audio). */}
      <AmbientAudioRoot />
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#f59e0b', // amber-500
          tabBarInactiveTintColor: '#a8a29e', // stone-400
          tabBarStyle: {
            backgroundColor: '#0c0a09', // stone-950
            borderTopColor: '#292524', // stone-800
          },
        }}
        screenListeners={{
          tabPress: () => playSfx('tab_switch'),
        }}
      >
        <Tabs.Screen name="quest-board" options={{ title: 'Quests' }} />
        <Tabs.Screen name="character-sheet" options={{ title: 'Character' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
        {/* xp-history is reachable only from the Character Sheet — hide it
            from the tab bar so it doesn't take a top-level slot. */}
        <Tabs.Screen name="xp-history" options={{ href: null }} />
      </Tabs>
    </View>
  );
}
