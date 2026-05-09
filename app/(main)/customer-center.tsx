import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { ParchmentScreen } from '../../lib/parchment';
import { isPurchasesReady } from '../../lib/purchases';

// react-native-purchases-ui CustomerCenter is native-only. Lazy-import
// behind a Platform guard.
async function loadCustomerCenter() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    const mod = await import('react-native-purchases-ui');
    return mod.default;
  } catch {
    return null;
  }
}

/**
 * RC's drop-in subscription management UI. Lets the user view their plan,
 * cancel, restore, see receipts. Only meaningful for Hero subscribers —
 * Settings hides the entry point for free users.
 */
export default function CustomerCenter() {
  const router = useRouter();
  const [RCUi, setRCUi] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadCustomerCenter().then((mod) => {
      if (cancelled) return;
      if (mod && isPurchasesReady()) setRCUi(() => mod);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <ParchmentScreen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#92400e" />
        </View>
      </ParchmentScreen>
    );
  }

  if (RCUi) {
    interface CustomerCenterProps {
      onDismiss?: () => void;
    }
    const CustomerCenterComponent = (
      RCUi as { CustomerCenter: React.ComponentType<CustomerCenterProps> }
    ).CustomerCenter;
    return (
      <View className="flex-1 bg-stone-950">
        <CustomerCenterComponent onDismiss={() => router.back()} />
      </View>
    );
  }

  // Web / unconfigured fallback — point the user at the platform's native
  // subscription settings since we can't deep-link from here.
  return (
    <ParchmentScreen>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-20 pb-12">
        <Pressable onPress={() => router.back()} className="mb-3 self-start active:opacity-60">
          <Text className="font-body text-xl text-amber-800">← Back</Text>
        </Pressable>
        <Text className="mb-6 font-display text-4xl text-stone-900">Manage subscription</Text>
        <Text className="mb-4 font-body text-xl leading-relaxed text-stone-800">
          The Customer Center opens on iOS and Android once the app is built natively. From there
          you can view your active pledge, cancel, restore prior purchases, or contact support.
        </Text>
        <Text className="font-body text-lg leading-relaxed text-stone-700">
          On web, head to the App Store or Google Play subscription settings to manage your
          pledge. Cancellations take effect at the end of the current billing period.
        </Text>
      </ScrollView>
    </ParchmentScreen>
  );
}
