import { Cinzel_400Regular, Cinzel_700Bold, useFonts } from '@expo-google-fonts/cinzel';
import {
  EBGaramond_400Regular,
  EBGaramond_500Medium,
  EBGaramond_600SemiBold,
} from '@expo-google-fonts/eb-garamond';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { AuthProvider, useProtectedRoute } from '../lib/auth';
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
        <RootLayoutNav />
        <StatusBar style="dark" />
      </AuthProvider>
    </GestureHandlerRootView>
  );
}
