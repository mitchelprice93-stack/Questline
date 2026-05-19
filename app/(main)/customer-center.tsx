import { useRouter } from 'expo-router';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { ParchmentScreen } from '../../lib/parchment';

// Deep links to the platform's native subscription management page,
// scoped to Questline where the platform supports it.
//
// Android: opens Play Store subscriptions, filtered to our subscription
// product if the user has a Hero subscription active.
// iOS: opens the App Store account subscriptions list (Apple doesn't
// support per-app filtering on this URL).
const ANDROID_SUBSCRIPTION_URL =
  'https://play.google.com/store/account/subscriptions?sku=hero_pro&package=com.mitchelprice.questline';
const IOS_SUBSCRIPTION_URL = 'https://apps.apple.com/account/subscriptions';

/**
 * Subscription management screen.
 *
 * Previously this rendered RC's native CustomerCenter overlay via
 * react-native-purchases-ui, but that component has known compatibility
 * issues with React Native's new architecture (newArchEnabled: true) and
 * was causing the app to freeze on open. Replaced with a custom in-app
 * screen that deep-links to the platform's native subscription settings
 *, which is what users want to do anyway (cancel, change payment,
 * restore prior purchase) and avoids the broken overlay entirely.
 *
 * Trade-off: we no longer surface receipt history or RC's built-in help
 * center in-app. For v1 closed-alpha this is acceptable; if users ask for
 * those flows we can build minimal versions natively.
 */
export default function CustomerCenter() {
  const router = useRouter();

  const openPlatformSubscriptions = async () => {
    const url = Platform.OS === 'ios' ? IOS_SUBSCRIPTION_URL : ANDROID_SUBSCRIPTION_URL;
    try {
      await Linking.openURL(url);
    } catch (e) {
      console.warn('[customer-center] failed to open platform subscriptions URL', e);
    }
  };

  return (
    <ParchmentScreen>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-20 pb-12">
        {/* Explicit route to /settings, router.back() in an Expo Router
            Tabs setup unwinds to the initial tab (Quest Board) rather than
            the previous screen. Customer center is only reached from the
            Settings → Manage subscription button. */}
        <Pressable
          onPress={() => router.replace('/settings')}
          className="mb-3 self-start active:opacity-60"
        >
          <Text className="font-body text-xl text-amber-800">← Back</Text>
        </Pressable>

        <Text className="mb-2 font-display text-4xl text-stone-900">Manage subscription</Text>
        <Text className="mb-8 font-body text-base text-amber-800">
          {Platform.OS === 'ios' ? 'Apple App Store' : 'Google Play'}
        </Text>

        <Text className="mb-6 font-body text-xl leading-relaxed text-stone-800">
          Subscriptions are managed through {Platform.OS === 'ios' ? "Apple's" : "Google's"}{' '}
          subscription settings. From there you can:
        </Text>

        <View className="mb-8 ml-2 gap-3">
          <Text className="font-body text-lg text-stone-700">· View your active pledge</Text>
          <Text className="font-body text-lg text-stone-700">· Cancel your subscription</Text>
          <Text className="font-body text-lg text-stone-700">· Change your payment method</Text>
          <Text className="font-body text-lg text-stone-700">· Restore prior purchases</Text>
        </View>

        <Pressable
          onPress={openPlatformSubscriptions}
          className="mb-3 rounded-md bg-amber-600 px-4 py-4 active:bg-amber-700"
        >
          <Text className="text-center font-display text-2xl text-stone-100">
            Open {Platform.OS === 'ios' ? 'App Store' : 'Play Store'} subscriptions
          </Text>
        </Pressable>

        <Text className="mt-6 font-body text-base leading-relaxed text-stone-600">
          Cancellations take effect at the end of the current billing period. Your Hero entitlement
          remains active until expiry, the Tome stays generous to the end.
        </Text>
      </ScrollView>
    </ParchmentScreen>
  );
}
