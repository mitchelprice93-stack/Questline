import { Cinzel_400Regular, Cinzel_700Bold, useFonts } from '@expo-google-fonts/cinzel';
import {
  EBGaramond_400Regular,
  EBGaramond_500Medium,
  EBGaramond_600SemiBold,
} from '@expo-google-fonts/eb-garamond';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Appearance, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useProtectedRoute } from '../lib/auth';
import { initColorMode } from '../lib/color-mode';
import '../global.css';

function RootLayoutNav() {
  useProtectedRoute();
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(onboarding)" />
      <Stack.Screen name="(main)" />
    </Stack>
  );
}

/** Reads the chronicler's color-mode preference once on boot and applies
 *  the resulting scheme to NativeWind. Lives in its own component so the
 *  setColorScheme hook can run inside the React tree. */
function ColorModeInit() {
  const { setColorScheme } = useColorScheme();
  useEffect(() => {
    void initColorMode((effective) => setColorScheme(effective));
    // While in 'system' mode, react live to OS appearance changes. The
    // useColorMode hook also subscribes, but mounting this listener at
    // the root means screens that don't call the hook still flip.
    const sub = Appearance.addChangeListener(({ colorScheme: sys }) => {
      // Best-effort: only honor the system change if the user is in
      // 'system' mode. We don't want a manual override to be overridden
      // by an OS toggle. The hook + initColorMode keep the cache truthy
      // so we can check it via the same module helper.
      void (async () => {
        const { getColorModePreference } = await import('../lib/color-mode');
        const pref = await getColorModePreference();
        if (pref === 'system') {
          setColorScheme(sys === 'dark' ? 'dark' : 'light');
        }
      })();
    });
    return () => sub.remove();
  }, [setColorScheme]);
  return null;
}

/** Status bar style follows the effective color scheme: dark icons on
 *  light parchment, light icons on the Midnight palette. */
function ThemedStatusBar() {
  const { colorScheme } = useColorScheme();
  return <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Cinzel_400Regular,
    Cinzel_700Bold,
    EBGaramond_400Regular,
    EBGaramond_500Medium,
    EBGaramond_600SemiBold,
  });

  if (!fontsLoaded && !fontError) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-950">
        <ActivityIndicator color="#a8a29e" />
      </View>
    );
  }
  if (fontError) {
    // Don't block the app on font errors, fall back to system fonts.
    console.warn('Font load failed; using system fonts:', fontError);
  }

  return (
    // GestureHandlerRootView is required on Android for react-native-gesture-handler
    // gestures to fire. Expo Router auto-wraps in recent versions, but adding it
    // explicitly here is idempotent and removes any doubt about gesture delivery
    // (used by the objectives drag-to-reorder handle on quest forms).
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <ColorModeInit />
        <RootLayoutNav />
        <ThemedStatusBar />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
