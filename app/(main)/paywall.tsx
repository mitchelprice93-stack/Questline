import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useAuth } from '../../lib/auth';
import { confirmDestructive, showInfoMessage } from '../../lib/dialogs';
import { errorMessage } from '../../lib/errors';
import { ParchmentScreen } from '../../lib/parchment';
import {
  getHeroPackages,
  isPurchasesReady,
  purchasePackageById,
  restorePurchases,
  type PackageDuration,
  type PaywallPackage,
} from '../../lib/purchases';
import { playSfx } from '../../lib/sfx';
import { FREE_TIER_QUEST_CAP } from '../../lib/subscription';

// react-native-purchases-ui is native-only. Lazy-import behind a Platform
// guard so web bundles don't try to resolve it.
async function loadRCPaywallView() {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return null;
  try {
    const mod = await import('react-native-purchases-ui');
    return mod.default;
  } catch {
    return null;
  }
}

/**
 * Paywall route. On native with RC configured we render RevenueCatUI's
 * dashboard-built PaywallView (drop-in, A/B-testable, remote config from
 * RC). On web / unconfigured we fall back to a custom in-world paywall
 * with all three package tiers — same purchase flow underneath.
 */
export default function Paywall() {
  const router = useRouter();
  const { refetchSubscription } = useAuth();

  const [packages, setPackages] = useState<PaywallPackage[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [RCPaywall, setRCPaywall] = useState<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [pkgs, RcUi] = await Promise.all([getHeroPackages(), loadRCPaywallView()]);
      if (cancelled) return;
      setPackages(pkgs);
      // Default selected package to the yearly tier if present (best-value
      // anchor); fall back to the first package otherwise.
      setSelected(pkgs.find((p) => p.duration === 'yearly')?.identifier ?? pkgs[0]?.identifier ?? null);
      // Only render RC's PaywallView when the SDK is initialized AND we got
      // real packages (not stubs). Stub identifiers end with '_stub'.
      if (RcUi && isPurchasesReady() && pkgs.length > 0 && !pkgs[0]?.identifier.endsWith('_stub')) {
        setRCPaywall(() => RcUi);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onPurchase = async (packageId?: string) => {
    const id = packageId ?? selected;
    if (!id) return;
    if (!isPurchasesReady()) {
      await showInfoMessage(
        'Pledge unavailable',
        'Hero subscriptions are wired but the SDK only initializes on native. Run `eas build --profile development` to test the real flow.',
      );
      return;
    }
    setError(null);
    setBusy('purchase');
    try {
      const result = await purchasePackageById(id);
      if (result.userCancelled) {
        setBusy(null);
        return;
      }
      if (result.heroActive) {
        playSfx('hero_pledge');
        await refetchSubscription();
        router.replace('/hero-cinematic');
      } else {
        await showInfoMessage(
          'Hmm',
          'The purchase completed but the entitlement didn\'t land. The Tome will reflect the change shortly — try again in a moment if it doesn\'t.',
        );
        setBusy(null);
      }
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  const onRestore = async () => {
    if (!isPurchasesReady()) {
      await showInfoMessage(
        'Restore unavailable',
        'Restore lights up on TestFlight / production builds.',
      );
      return;
    }
    setBusy('restore');
    setError(null);
    try {
      const heroActive = await restorePurchases();
      if (heroActive) {
        playSfx('hero_pledge');
        await refetchSubscription();
        await showInfoMessage(
          'Welcome back, Hero',
          'Your earlier pledge has been restored. The Tome opens fully again.',
        );
        router.replace('/hero-cinematic');
      } else {
        await showInfoMessage('Nothing to restore', 'No prior pledge was found for this account.');
        setBusy(null);
      }
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  };

  const onDismiss = async () => {
    const proceed = await confirmDestructive(
      'Leave the gates?',
      'You can return any time from Settings. The Tome remains as it is.',
    );
    if (proceed) router.back();
  };

  // ---- RC PaywallView path (native + configured) -------------------------
  // The dashboard-built paywall handles its own UI; we just listen for the
  // dismiss / purchase callbacks and route accordingly. The runtime
  // component is typed loosely (the SDK's React types accept arbitrary
  // event-handler props), so we render through a casted handle.
  if (RCPaywall) {
    interface RCPaywallProps {
      onPurchaseCompleted?: () => void | Promise<void>;
      onRestoreCompleted?: () => void | Promise<void>;
      onDismiss?: () => void;
    }
    const PaywallComponent = (RCPaywall as { Paywall: React.ComponentType<RCPaywallProps> })
      .Paywall;
    return (
      <View className="flex-1 bg-stone-950">
        <PaywallComponent
          onPurchaseCompleted={async () => {
            playSfx('hero_pledge');
            await refetchSubscription();
            router.replace('/hero-cinematic');
          }}
          onRestoreCompleted={async () => {
            playSfx('hero_pledge');
            await refetchSubscription();
            router.replace('/hero-cinematic');
          }}
          onDismiss={() => router.back()}
        />
      </View>
    );
  }

  // ---- Custom fallback path (web + unconfigured) -------------------------
  return (
    <ParchmentScreen>
      <ScrollView className="flex-1" contentContainerClassName="px-6 pt-20 pb-12">
        <Pressable onPress={() => router.back()} className="mb-3 self-start active:opacity-60">
          <Text className="font-body text-xl text-amber-800">← Back</Text>
        </Pressable>

        <Animated.View entering={FadeInDown.duration(450)}>
          <Text className="mb-2 font-display text-xs uppercase tracking-[0.4em] text-amber-800">
            The Archivist offers
          </Text>
          <Text className="mb-6 font-display text-4xl text-stone-900">Pledge your oath</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(550).delay(120)} className="mb-8">
          <Text className="font-body text-xl leading-relaxed text-stone-800">
            The Tome is generous, but its bindings hold only so much at once. Pledge your oath, and
            the Archivist will inscribe without limit.
          </Text>
        </Animated.View>

        {/* Comparison card */}
        <Animated.View entering={FadeInDown.duration(600).delay(220)} className="mb-6">
          <View className="mb-3 rounded-md border border-stone-700 bg-amber-50/40 p-4">
            <Text className="font-display text-sm uppercase tracking-widest text-stone-700">
              Free chronicler
            </Text>
            <Text className="mt-1 font-body text-lg text-stone-800">
              Up to {FREE_TIER_QUEST_CAP} active quests at once.
            </Text>
            <Text className="mt-1 font-body text-base text-stone-600">
              Every other mechanic of the Tome opens to you.
            </Text>
          </View>
        </Animated.View>

        {/* Package picker */}
        <Animated.View entering={FadeInDown.duration(700).delay(320)} className="mb-6">
          <Text className="mb-3 font-display text-sm uppercase tracking-widest text-amber-800">
            Choose your pledge
          </Text>
          {packages === null ? (
            <View className="items-center py-6">
              <ActivityIndicator color="#92400e" />
            </View>
          ) : (
            <View className="gap-2">
              {packages.map((pkg) => (
                <PackageCard
                  key={pkg.identifier}
                  pkg={pkg}
                  selected={selected === pkg.identifier}
                  onPress={() => setSelected(pkg.identifier)}
                />
              ))}
            </View>
          )}
        </Animated.View>

        {error ? <Text className="mb-4 font-body text-base text-red-700">{error}</Text> : null}

        <Animated.View entering={FadeInDown.duration(700).delay(420)}>
          <Pressable
            onPress={() => onPurchase()}
            disabled={busy !== null || !selected}
            className={`mb-3 rounded-md px-4 py-4 ${
              busy || !selected ? 'bg-amber-100/40' : 'bg-amber-600 active:bg-amber-700'
            }`}
          >
            <Text className="text-center font-display text-2xl text-stone-100">
              {busy === 'purchase' ? 'The Tome receives your oath…' : 'Pledge'}
            </Text>
          </Pressable>

          <Pressable
            onPress={onRestore}
            disabled={busy !== null}
            className="mb-3 rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
          >
            <Text className="text-center font-body text-lg text-stone-800">
              {busy === 'restore' ? 'Searching the registry…' : 'Restore prior pledge'}
            </Text>
          </Pressable>

          <Pressable
            onPress={onDismiss}
            disabled={busy !== null}
            className="rounded-md px-4 py-3 active:opacity-60"
          >
            <Text className="text-center font-body text-base text-stone-600">
              Not now — return to the Tome
            </Text>
          </Pressable>
        </Animated.View>

        <Text className="mt-8 text-center font-body text-sm text-stone-600">
          Subscriptions auto-renew. Cancel any time from your platform&apos;s subscription settings.
        </Text>
      </ScrollView>
    </ParchmentScreen>
  );
}

function PackageCard({
  pkg,
  selected,
  onPress,
}: {
  pkg: PaywallPackage;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-md border-2 p-4 ${
        selected
          ? 'border-amber-700 bg-amber-100/60'
          : 'border-stone-700 bg-amber-50/40 active:bg-amber-100/40'
      }`}
    >
      <View className="flex-row items-baseline justify-between">
        <Text className="font-display text-xl text-stone-900">
          {durationLabel(pkg.duration)}
        </Text>
        <Text className="font-display text-2xl text-amber-800">
          {pkg.priceString}
          {pkg.period ? <Text className="font-body text-base"> / {pkg.period}</Text> : null}
        </Text>
      </View>
      {pkg.caption ? (
        <Text className="mt-1 font-body text-base text-stone-600">{pkg.caption}</Text>
      ) : null}
    </Pressable>
  );
}

function durationLabel(d: PackageDuration): string {
  switch (d) {
    case 'lifetime':
      return 'Lifetime';
    case 'yearly':
      return 'Yearly';
    case 'monthly':
      return 'Monthly';
  }
}
