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
          // Tab bar gets a warm sepia tone so it sits cleanly on parchment.
          tabBarActiveTintColor: '#fcd34d', // amber-300 — bright ink against dark leather
          tabBarInactiveTintColor: '#a8a29e', // stone-400 — faded
          tabBarStyle: {
            backgroundColor: '#3f2e1d', // dark sepia, like leather binding
            borderTopColor: '#78350f', // amber-900
            // Bump the bar height — middle of the screen has plenty of room
            // and the larger target feels more game-like.
            height: 78,
            paddingTop: 10,
            paddingBottom: 14,
          },
          tabBarLabelStyle: {
            fontFamily: 'Cinzel_400Regular',
            fontSize: 15,
            textTransform: 'uppercase',
            letterSpacing: 1.5,
            marginTop: 2,
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
