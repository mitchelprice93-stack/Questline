import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Dimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AchievementSurface } from '../../components/AchievementSurface';
import { TUTORIAL_STEPS, TutorialOverlay } from '../../components/tutorial-overlay';
import { AmbientAudioRoot } from '../../lib/ambient-audio';
import { initOfflineQueue } from '../../lib/offline-queue';
// Side-effect import: registers the createQuest replay handler with the
// offline queue. Must happen before initOfflineQueue's first drain.
import '../../lib/quests';
import { playSfx } from '../../lib/sfx';
import { TutorialProvider, useTutorial } from '../../lib/tutorial-context';

// Bar visuals: 92px for the icon + Cinzel label. On Android with the
// 3-button nav bar visible, we also need to extend below by insets.bottom
// so the labels and tap targets clear the system buttons. The tutorial
// spotlight rect uses the SAME effective height so it tracks the live bar.
const TAB_BAR_HEIGHT_BASE = 92;

export default function MainLayout() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Extend the bar by the bottom safe-area inset so the tab labels and tap
  // targets clear the Android 3-button nav bar (or the home indicator on
  // iOS). On devices with gesture nav / no inset, this collapses to 0 and
  // the bar stays at its base size.
  const tabBarHeight = TAB_BAR_HEIGHT_BASE + insets.bottom;
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
      <AnchoredLayoutRoot>
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
              // Bigger bar to fit the larger Cinzel label, plus inset so the
              // labels clear the Android nav buttons.
              height: tabBarHeight,
              paddingTop: 12,
              paddingBottom: 16 + insets.bottom,
            },
            tabBarLabelStyle: {
              fontFamily: 'Cinzel_400Regular',
              // Reduced from 19 to 16 so "CHARACTER" (9 chars + wide tracking)
              // fits a 1/3-screen tab without truncating to "CHARACTE".
              fontSize: 16,
              textTransform: 'uppercase',
              letterSpacing: 1.5,
              marginTop: 2,
            },
          }}
          screenListeners={{
            tabPress: () => playSfx('tab_switch'),
          }}
        >
          <Tabs.Screen
            name="quest-board"
            options={{
              title: 'Quests',
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="book-open-page-variant" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="character-sheet"
            options={{
              title: 'Character',
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="shield-account" size={size} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: 'Settings',
              tabBarIcon: ({ color, size }) => (
                <MaterialCommunityIcons name="cog" size={size} color={color} />
              ),
            }}
          />
          {/* xp-history is reachable only from the Character Sheet — hide it
              from the tab bar so it doesn't take a top-level slot. */}
          <Tabs.Screen name="xp-history" options={{ href: null }} />
          {/* Paywall and post-purchase cinematic — reachable only via the
              Settings → Pledge flow, hidden from the tab bar. */}
          <Tabs.Screen name="paywall" options={{ href: null }} />
          <Tabs.Screen name="hero-cinematic" options={{ href: null }} />
          <Tabs.Screen name="customer-center" options={{ href: null }} />
          {/* Achievements screen — reachable from the Character Sheet's
              "Achievements: N / 24" line, hidden from the tab bar. */}
          <Tabs.Screen name="achievements" options={{ href: null }} />
        </Tabs>
        <TabBarTutorialAnchor height={tabBarHeight} />
        {/* First-launch orientation. Renders nothing once the user has
            dismissed it; lives at the layout root so it can overlay any
            tab the user happens to be on. */}
        <TutorialOverlay />
        {/* Achievement toast / cinematic surface. Subscribes to the global
            feed; mounted once at the root so it overlays whichever tab
            the user happens to be on when an achievement fires. */}
        <AchievementSurface />
      </AnchoredLayoutRoot>
    </TutorialProvider>
  );
}

/**
 * Wraps the main layout's flex-1 View with a ref handed to the tutorial
 * context. TutorialTarget measures children relative to THIS View, and
 * TutorialOverlay sits inside it — same coordinate origin for both, no
 * window/safe-area mismatch to compensate for.
 *
 * collapsable={false} prevents Android from optimizing the wrapper away,
 * which would invalidate the ref.
 */
function AnchoredLayoutRoot({ children }: { children: React.ReactNode }) {
  const { anchorRef } = useTutorial();
  return (
    <View ref={anchorRef} collapsable={false} className="flex-1">
      {children}
    </View>
  );
}

/**
 * The Expo Router Tabs component renders the tab bar internally, so we
 * can't wrap it in <TutorialTarget>. This component publishes a virtual
 * rect for the tab bar instead — measured from the tutorial anchor View's
 * bounds (not Dimensions.get('window')) so the rect lives in the same
 * coordinate system as the overlay paints.
 */
function TabBarTutorialAnchor({ height: barHeight }: { height: number }) {
  const { registerTarget, anchorRef } = useTutorial();
  useEffect(() => {
    const publish = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      anchor.measureInWindow((_x, _y, width, height) => {
        registerTarget('tab-bar', {
          x: 0,
          y: Math.max(0, height - barHeight),
          width,
          height: barHeight,
        });
      });
    };
    // Defer to next frame so the anchor has its layout pass done.
    const handle = requestAnimationFrame(publish);
    const sub = Dimensions.addEventListener('change', publish);
    return () => {
      cancelAnimationFrame(handle);
      sub.remove();
    };
  }, [registerTarget, anchorRef, barHeight]);
  return null;
}
