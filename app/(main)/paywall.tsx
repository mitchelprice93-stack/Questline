import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useAuth } from '../../lib/auth';
import { confirmDestructive, showInfoMessage } from '../../lib/dialogs';
import { errorMessage } from '../../lib/errors';
import { ParchmentScreen } from '../../lib/parchment';
import {
  getHeroPackage,
  isPurchasesReady,
  purchaseHero,
  restorePurchases,
  type PaywallPackage,
} from '../../lib/purchases';
import { playSfx } from '../../lib/sfx';
import { FREE_TIER_QUEST_CAP } from '../../lib/subscription';

export default function Paywall() {
  const router = useRouter();
  const { refetchSubscription } = useAuth();

  const [pkg, setPkg] = useState<PaywallPackage | null>(null);
  const [busy, setBusy] = useState<'purchase' | 'restore' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getHeroPackage().then((p) => {
      if (!cancelled) setPkg(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPurchase = async () => {
    if (!pkg) return;
    if (!isPurchasesReady()) {
      // Stub mode (web / no API key). Show the user where the real flow will
      // live so it's clear nothing's broken.
      await showInfoMessage(
        'Pledge unavailable',
        'Hero subscriptions are configured but not yet live in this build. The full purchase flow lights up on a TestFlight / production native build.',
      );
      return;
    }
    setError(null);
    setBusy('purchase');
    try {
      const result = await purchaseHero(pkg.identifier);
      if (result.userCancelled) {
        setBusy(null);
        return;
      }
      if (result.heroActive) {
        playSfx('hero_pledge');
        // Refetch from our DB after the RC webhook updates subscriptions.
        await refetchSubscription();
        // Hand off to the upgrade cinematic.
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
        'Restore lights up on TestFlight / production builds once the RevenueCat keys are in place.',
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
        await showInfoMessage(
          'Nothing to restore',
          'No prior pledge was found for this account.',
        );
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
        <Animated.View entering={FadeInDown.duration(600).delay(220)} className="mb-8">
          <View className="mb-3 rounded-md border border-stone-700 bg-amber-50/40 p-4">
            <Text className="font-display text-sm uppercase tracking-widest text-stone-700">
              Free chronicler
            </Text>
            <Text className="mt-1 font-body text-lg text-stone-800">
              Up to {FREE_TIER_QUEST_CAP} active quests at once.
            </Text>
            <Text className="mt-1 font-body text-base text-stone-600">
              Every other mechanic of the Tome — buffs, debuffs, streaks, the chronicle — open to
              you.
            </Text>
          </View>

          <View className="rounded-md border border-amber-700/60 bg-amber-100/40 p-4">
            <Text className="font-display text-sm uppercase tracking-widest text-amber-800">
              Hero · pledged to the Archivist
            </Text>
            <Text className="mt-1 font-body text-lg text-stone-800">
              No cap on active quests. The Tome opens fully.
            </Text>
            <Text className="mt-1 font-body text-base text-stone-600">
              Same mechanics, no ceiling. Carry as many endeavors as your week demands.
            </Text>
          </View>
        </Animated.View>

        {error ? (
          <Text className="mb-4 font-body text-base text-red-700">{error}</Text>
        ) : null}

        <Animated.View entering={FadeInDown.duration(700).delay(320)}>
          {pkg === null ? (
            <View className="items-center py-6">
              <ActivityIndicator color="#92400e" />
            </View>
          ) : (
            <Pressable
              onPress={onPurchase}
              disabled={busy !== null}
              className={`mb-3 rounded-md px-4 py-4 ${
                busy ? 'bg-amber-100/40' : 'bg-amber-600 active:bg-amber-700'
              }`}
            >
              <Text className="text-center font-display text-2xl text-stone-100">
                {busy === 'purchase'
                  ? 'The Tome receives your oath…'
                  : `Pledge — ${pkg.priceString} / ${pkg.period ?? 'month'}`}
              </Text>
            </Pressable>
          )}

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
          Subscriptions auto-renew. Cancel any time from your platform&apos;s subscription
          settings.
        </Text>
      </ScrollView>
    </ParchmentScreen>
  );
}
