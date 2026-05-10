import { Tabs, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Dimensions, View } from 'react-native';

import { TUTORIAL_STEPS, TutorialOverlay } from '../../components/tutorial-overlay';
import { AmbientAudioRoot } from '../../lib/ambient-audio';
import { initOfflineQueue } from '../../lib/offline-queue';
// Side-effect import: registers the createQuest replay handler with the
// offline queue. Must happen before initOfflineQueue's first drain.
import '../../lib/quests';
import { playSfx } from '../../lib/sfx';
import { TutorialProvider, useTutorial } from '../../lib/tutorial-context';

const TAB_BAR_HEIGHT = 92;

export default function MainLayout() {
  const router = useRouter();
  const onTutorialStart = useCallback(() => {
    // The tutorial walks through Quest Board UI first; route there in case
    // the user is on Settings or Character when they tap "Replay orientation".
    router.replace('/(main)/quest-board');
  }, [router]);

  // Wire up the offline write queue once. Drains any pending mutations
  // on initial load and on every app foreground (covers reconnect-while-
  // backgrounded). Idempotent — safe if MainLayout remounts.
  useEffect(() => {
    initOfflineQueue();
  }, []);

  return (
    <TutorialProvider totalSteps={TUTORIAL_STEPS.length} onStart={onTutorialStart}>
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
              // Bigger bar to fit the larger Cinzel label.
              height: TAB_BAR_HEIGHT,
              paddingTop: 12,
              paddingBottom: 16,
            },
            tabBarLabelStyle: {
              fontFamily: 'Cinzel_400Regular',
              fontSize: 19,
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
          {/* Paywall and post-purchase cinematic — reachable only via the
              Settings → Pledge flow, hidden from the tab bar. */}
          <Tabs.Screen name="paywall" options={{ href: null }} />
          <Tabs.Screen name="hero-cinematic" options={{ href: null }} />
          <Tabs.Screen name="customer-center" options={{ href: null }} />
        </Tabs>
        <TabBarTutorialAnchor />
        {/* First-launch orientation. Renders nothing once the user has
            dismissed it; lives at the layout root so it can overlay any
            tab the user happens to be on. */}
        <TutorialOverlay />
      </View>
    </TutorialProvider>
  );
}

/**
 * The Expo Router Tabs component renders the tab bar internally, so we
 * can't wrap it in <TutorialTarget>. This component publishes a virtual
 * rect for the tab bar instead — its fixed height + the screen width
 * give us the geometry the spotlight needs.
 */
function TabBarTutorialAnchor() {
  const { registerTarget } = useTutorial();
  useEffect(() => {
    const publish = () => {
      const { width, height } = Dimensions.get('window');
      registerTarget('tab-bar', {
        x: 0,
        y: Math.max(0, height - TAB_BAR_HEIGHT),
        width,
        height: TAB_BAR_HEIGHT,
      });
    };
    publish();
    const sub = Dimensions.addEventListener('change', publish);
    return () => sub.remove();
  }, [registerTarget]);
  return null;
}
