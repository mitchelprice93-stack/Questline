// Phase 5.1 — RevenueCat client wrapper.
//
// react-native-purchases needs native code; on web it's not available.
// Every helper here is Platform-aware and gracefully no-ops outside iOS/
// Android, so web dogfooding still runs while the native paywall works
// on EAS dev / production builds.
//
// Configuration: add EXPO_PUBLIC_REVENUECAT_IOS_KEY and
// EXPO_PUBLIC_REVENUECAT_ANDROID_KEY to .env.local once you've created a
// project in the RevenueCat dashboard. Without keys, configurePurchases
// silently skips initialization — paywall will show a stub state.

import { Platform } from 'react-native';

import { errorMessage } from './errors';

const IS_NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

// Lazy-imported on native; web never touches this module.
type PurchasesModule = typeof import('react-native-purchases');
let Purchases: PurchasesModule['default'] | null = null;
let configured = false;

async function loadPurchases(): Promise<PurchasesModule['default'] | null> {
  if (!IS_NATIVE) return null;
  if (Purchases) return Purchases;
  try {
    const mod = await import('react-native-purchases');
    Purchases = mod.default;
    return Purchases;
  } catch (e) {
    console.warn('[purchases] failed to load react-native-purchases', errorMessage(e));
    return null;
  }
}

/**
 * Initialize the RevenueCat SDK. Call once at app start (after the user is
 * signed in, ideally — RC accepts a userId for cross-device sync).
 *
 * No-op on web and when the platform-specific API key is missing.
 */
export async function configurePurchases(userId?: string): Promise<void> {
  if (!IS_NATIVE) return;
  if (configured) {
    if (userId) await loginPurchases(userId);
    return;
  }

  const apiKey =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY
      : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
  if (!apiKey) {
    console.warn(
      '[purchases] no RevenueCat API key set; skipping init. ' +
        'Add EXPO_PUBLIC_REVENUECAT_IOS_KEY / _ANDROID_KEY to .env.local once your RC project exists.',
    );
    return;
  }

  const p = await loadPurchases();
  if (!p) return;
  try {
    await p.configure({ apiKey, appUserID: userId ?? null });
    configured = true;
  } catch (e) {
    console.warn('[purchases] configure failed', errorMessage(e));
  }
}

/** Tell RevenueCat which user is signed in. Call this after signIn so RC
 *  can attribute purchases to the right account across devices. */
export async function loginPurchases(userId: string): Promise<void> {
  if (!IS_NATIVE || !configured) return;
  const p = await loadPurchases();
  if (!p) return;
  try {
    await p.logIn(userId);
  } catch (e) {
    console.warn('[purchases] logIn failed', errorMessage(e));
  }
}

/** Reset RC's user identity on sign-out. */
export async function logoutPurchases(): Promise<void> {
  if (!IS_NATIVE || !configured) return;
  const p = await loadPurchases();
  if (!p) return;
  try {
    await p.logOut();
  } catch (e) {
    console.warn('[purchases] logOut failed', errorMessage(e));
  }
}

// ---- Paywall surface --------------------------------------------------------

export interface PaywallPackage {
  identifier: string;
  /** Display title — e.g. "Hero · Monthly". */
  title: string;
  /** Localized price string from the store — e.g. "$3.00". */
  priceString: string;
  /** Period descriptor — e.g. "month". Optional. */
  period: string | null;
}

/**
 * Stub package shown when RC isn't initialized (web, missing keys, etc.)
 * so the paywall screen has something to render and the user gets the copy.
 */
const STUB_PACKAGE: PaywallPackage = {
  identifier: 'hero_monthly_stub',
  title: 'Hero · Monthly',
  priceString: '$3.00',
  period: 'month',
};

/**
 * Fetch the current Hero offering's monthly package. Returns the stub when
 * RC isn't configured so the paywall doesn't render empty.
 */
export async function getHeroPackage(): Promise<PaywallPackage> {
  if (!IS_NATIVE || !configured) return STUB_PACKAGE;
  const p = await loadPurchases();
  if (!p) return STUB_PACKAGE;
  try {
    const offerings = await p.getOfferings();
    const current = offerings.current;
    const pkg = current?.monthly ?? current?.availablePackages?.[0];
    if (!pkg) return STUB_PACKAGE;
    return {
      identifier: pkg.identifier,
      title: pkg.product.title || 'Hero · Monthly',
      priceString: pkg.product.priceString,
      period: pkg.packageType ?? 'month',
    };
  } catch (e) {
    console.warn('[purchases] getOfferings failed; using stub', errorMessage(e));
    return STUB_PACKAGE;
  }
}

export interface PurchaseResult {
  /** True when the purchase entitled the user to Hero. */
  heroActive: boolean;
  /** True when the user cancelled the native sheet. UI shouldn't show an error. */
  userCancelled: boolean;
}

/**
 * Initiate the native purchase flow for the currently-displayed package.
 * Resolves with heroActive=true on success. The actual subscription state
 * also lands in our DB via the RevenueCat → Supabase webhook; the client
 * usually refetches the subscription after this returns.
 */
export async function purchaseHero(packageIdentifier: string): Promise<PurchaseResult> {
  if (!IS_NATIVE || !configured) {
    return {
      heroActive: false,
      userCancelled: false,
    };
  }
  const p = await loadPurchases();
  if (!p) return { heroActive: false, userCancelled: false };

  try {
    const offerings = await p.getOfferings();
    const pkg =
      offerings.current?.availablePackages?.find((x) => x.identifier === packageIdentifier) ??
      offerings.current?.monthly;
    if (!pkg) {
      throw new Error('No package available — RevenueCat offerings may not be configured.');
    }
    const { customerInfo } = await p.purchasePackage(pkg);
    const heroActive = !!customerInfo.entitlements.active.hero;
    return { heroActive, userCancelled: false };
  } catch (e) {
    // RC throws a specific shape on user-cancellation that we should swallow.
    const err = e as { userCancelled?: boolean; code?: string };
    if (err?.userCancelled) {
      return { heroActive: false, userCancelled: true };
    }
    throw e;
  }
}

/**
 * Restore previously-purchased entitlements (e.g., user reinstalled the app
 * or switched devices). Returns true when Hero is active afterward.
 */
export async function restorePurchases(): Promise<boolean> {
  if (!IS_NATIVE || !configured) return false;
  const p = await loadPurchases();
  if (!p) return false;
  try {
    const customerInfo = await p.restorePurchases();
    return !!customerInfo.entitlements.active.hero;
  } catch (e) {
    console.warn('[purchases] restore failed', errorMessage(e));
    return false;
  }
}

/** True when the SDK has been configured (real keys present + native). */
export function isPurchasesReady(): boolean {
  return configured;
}
