import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { AmbientAudioRoot } from '../../lib/ambient-audio';
import { ParchmentBackground } from '../../lib/parchment';
import { playSfx } from '../../lib/sfx';

export default function MainLayout() {
  return (
    // Vellum fallback color — if expo-image is slow to decode the parchment
    // PNG, the user sees warm beige instead of pure white during load.
    <View className="flex-1 bg-amber-50">
      {/* Parchment canvas behind everything else in (main). Each screen
          renders with a transparent root so this shows through. */}
      <ParchmentBackground />
      {/* Ambient music bed — only mounts inside the main app, not during
          the cinematic or onboarding (which have their own audio). */}
      <AmbientAudioRoot />
      <Tabs
        screenOptions={{
          headerShown: false,
          // Tab bar gets a warm sepia tone so it sits cleanly on parchment.
          tabBarActiveTintColor: '#92400e', // amber-800 — strong ink
          tabBarInactiveTintColor: '#78716c', // stone-500 — faded ink
          tabBarStyle: {
            backgroundColor: '#3f2e1d', // dark sepia, like leather binding
            borderTopColor: '#78350f', // amber-900
          },
          // Without this the scene container renders an opaque default
          // background that covers our parchment. Transparent here lets
          // the canvas show through every tab.
          sceneStyle: { backgroundColor: 'transparent' },
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
