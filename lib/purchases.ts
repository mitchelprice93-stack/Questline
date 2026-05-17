// Phase 5.1 — RevenueCat client wrapper.
//
// react-native-purchases needs native code; on web it's not available.
// Every helper here is Platform-aware and gracefully no-ops outside iOS/
// Android, so web dogfooding still runs while the native paywall works
// on EAS dev / production builds.
//
// Configuration: set EXPO_PUBLIC_REVENUECAT_IOS_KEY and
// EXPO_PUBLIC_REVENUECAT_ANDROID_KEY in .env.local. RC test-mode keys
// (prefixed `test_`) work without App Store / Play Console products
// configured — useful for paywall iteration.

import { Platform } from 'react-native';

import { errorMessage } from './errors';

const IS_NATIVE = Platform.OS === 'ios' || Platform.OS === 'android';

// Entitlement identifier configured in the RC dashboard. The Hero tier in
// our DB corresponds to anyone who holds this entitlement. If you rename
// it in the dashboard, also rename it here.
export const HERO_ENTITLEMENT_ID = 'Questline Pro';

// Lazy-imported on native; web never touches this module.
type PurchasesModule = typeof import('react-native-purchases');
let Purchases: PurchasesModule['default'] | null = null;
let configured = false;
// Last error from a configure() attempt — surfaced through the paywall
// when configured is false, so the chronicler (and Mitchel) can see
// what's actually broken instead of a generic "unreachable" message.
let lastConfigureError: string | null = null;

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
    const msg =
      'No RevenueCat API key in build. EXPO_PUBLIC_REVENUECAT_ANDROID_KEY is missing from the AAB env.';
    console.warn('[purchases]', msg);
    lastConfigureError = msg;
    return;
  }

  // RC's native SDK force-closes production builds that try to configure with
  // a sandbox `test_*` key — they refuse to mix test keys into production
  // surface area for purchase-security reasons. If we detect one, skip init
  // entirely: the paywall falls back to its STUB_PACKAGES path, no purchases
  // work, but the app doesn't crash on launch. Swap to `goog_*` / `appl_*`
  // production keys (RC dashboard → Project → API keys) to re-enable purchases.
  if (apiKey.startsWith('test_')) {
    const msg =
      'Test RC key (test_*) detected in production build. SDK init skipped to prevent crash. Need a goog_* key.';
    console.warn('[purchases]', msg);
    lastConfigureError = msg;
    return;
  }

  const p = await loadPurchases();
  if (!p) {
    const msg = 'Failed to load react-native-purchases module (lazy import returned null).';
    console.warn('[purchases]', msg);
    lastConfigureError = msg;
    return;
  }
  try {
    await p.configure({ apiKey, appUserID: userId ?? null });
    configured = true;
    lastConfigureError = null;
  } catch (e) {
    const msg = `configure() threw: ${errorMessage(e)} (key prefix: ${apiKey.slice(0, 5)}…)`;
    console.warn('[purchases]', msg);
    lastConfigureError = msg;
  }
}

/** Last error from a configure() attempt, or null if it succeeded.
 *  The paywall uses this to surface the actual reason for SDK
 *  unavailability instead of a generic message. */
export function getLastConfigureError(): string | null {
  return lastConfigureError;
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

export type PackageDuration = 'lifetime' | 'yearly' | 'monthly';

export interface PaywallPackage {
  identifier: string;
  duration: PackageDuration;
  /** Display title — e.g. "Hero · Monthly". */
  title: string;
  /** Localized price string from the store — e.g. "$3.00". */
  priceString: string;
  /** Period descriptor — e.g. "month". null for lifetime. */
  period: string | null;
  /** Description text — e.g. "Best value · save 40%". Optional. */
  caption?: string;
}

/**
 * Stub packages shown when RC isn't initialized (web, missing keys, etc.)
 * so the custom paywall has something to render. Replaced by real RC
 * offerings once the SDK is configured AND the dashboard has products.
 *
 * Order: monthly → yearly → lifetime. Matches the Play Console subscription
 * management page so users see tiers in the same sequence across both
 * surfaces. Yearly stays in the middle as the recommended "best value"
 * anchor — see the default-selected logic in paywall.tsx.
 */
const STUB_PACKAGES: PaywallPackage[] = [
  {
    identifier: 'monthly_stub',
    duration: 'monthly',
    title: 'Hero · Monthly',
    priceString: '$2.99',
    period: 'month',
  },
  {
    identifier: 'yearly_stub',
    duration: 'yearly',
    title: 'Hero · Yearly',
    priceString: '$29.99',
    period: 'year',
    caption: 'Best value — save 17% vs monthly',
  },
  {
    identifier: 'lifetime_stub',
    duration: 'lifetime',
    title: 'Hero · Lifetime',
    priceString: '$59.99',
    period: null,
    caption: 'One pledge, forever',
  },
];

/**
 * Fetch every available package in the current Hero offering, ordered
 * monthly → yearly → lifetime to match the Play Console management page.
 * Returns stubs when RC isn't configured.
 */
export async function getHeroPackages(): Promise<PaywallPackage[]> {
  if (!IS_NATIVE || !configured) return STUB_PACKAGES;
  const p = await loadPurchases();
  if (!p) return STUB_PACKAGES;
  try {
    const offerings = await p.getOfferings();
    const current = offerings.current;
    if (!current) return STUB_PACKAGES;

    const result: PaywallPackage[] = [];
    if (current.monthly) result.push(toPaywallPackage(current.monthly, 'monthly'));
    if (current.annual) result.push(toPaywallPackage(current.annual, 'yearly'));
    if (current.lifetime) result.push(toPaywallPackage(current.lifetime, 'lifetime'));

    // If the offering doesn't slot into the standard lifetime/annual/monthly
    // buckets, fall back to walking availablePackages and best-effort
    // mapping by packageType.
    if (result.length === 0) {
      for (const pkg of current.availablePackages ?? []) {
        const duration = mapPackageType(pkg.packageType);
        if (duration) result.push(toPaywallPackage(pkg, duration));
      }
    }

    return result.length > 0 ? result : STUB_PACKAGES;
  } catch (e) {
    console.warn('[purchases] getOfferings failed; using stubs', errorMessage(e));
    return STUB_PACKAGES;
  }
}

// Convert RC's PurchasesPackage to our slimmer PaywallPackage shape.
function toPaywallPackage(pkg: unknown, duration: PackageDuration): PaywallPackage {
  // RC types are loosely structured at runtime — pull what we need.
  const p = pkg as {
    identifier: string;
    product: { title?: string; priceString: string; description?: string };
    packageType?: string;
  };
  return {
    identifier: p.identifier,
    duration,
    title: p.product.title || `Hero · ${duration[0]?.toUpperCase()}${duration.slice(1)}`,
    priceString: p.product.priceString,
    period: duration === 'lifetime' ? null : duration === 'yearly' ? 'year' : 'month',
  };
}

function mapPackageType(packageType: string | undefined): PackageDuration | null {
  if (!packageType) return null;
  const t = packageType.toLowerCase();
  if (t.includes('lifetime')) return 'lifetime';
  if (t.includes('annual') || t.includes('yearly')) return 'yearly';
  if (t.includes('monthly')) return 'monthly';
  return null;
}

export interface PurchaseResult {
  /** True when the purchase entitled the user to Hero (Questline Pro). */
  heroActive: boolean;
  /** True when the user cancelled the native sheet — UI shouldn't show an error. */
  userCancelled: boolean;
}

/**
 * Initiate the native purchase flow for a specific package identifier.
 * Resolves with heroActive=true on success. The actual subscription state
 * also lands in our DB via the RevenueCat → Supabase webhook; the client
 * usually refetches the subscription after this returns.
 */
export async function purchasePackageById(packageIdentifier: string): Promise<PurchaseResult> {
  if (!IS_NATIVE || !configured) {
    return { heroActive: false, userCancelled: false };
  }
  const p = await loadPurchases();
  if (!p) return { heroActive: false, userCancelled: false };

  try {
    const offerings = await p.getOfferings();
    const pkg = offerings.current?.availablePackages?.find(
      (x) => x.identifier === packageIdentifier,
    );
    if (!pkg) {
      throw new Error('Package not found in current RevenueCat offering.');
    }
    const { customerInfo } = await p.purchasePackage(pkg);
    return {
      heroActive: !!customerInfo.entitlements.active[HERO_ENTITLEMENT_ID],
      userCancelled: false,
    };
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
 * or switched devices). Returns true when the Hero entitlement is active
 * afterward.
 */
export async function restorePurchases(): Promise<boolean> {
  if (!IS_NATIVE || !configured) return false;
  const p = await loadPurchases();
  if (!p) return false;
  try {
    const customerInfo = await p.restorePurchases();
    return !!customerInfo.entitlements.active[HERO_ENTITLEMENT_ID];
  } catch (e) {
    console.warn('[purchases] restore failed', errorMessage(e));
    return false;
  }
}

/**
 * Read current entitlement state without prompting the user. Useful for
 * the AuthContext to verify our DB subscription row matches what RC
 * thinks (catches webhook delays).
 */
export async function getCurrentEntitlement(): Promise<{ heroActive: boolean }> {
  if (!IS_NATIVE || !configured) return { heroActive: false };
  const p = await loadPurchases();
  if (!p) return { heroActive: false };
  try {
    const customerInfo = await p.getCustomerInfo();
    return { heroActive: !!customerInfo.entitlements.active[HERO_ENTITLEMENT_ID] };
  } catch (e) {
    console.warn('[purchases] getCustomerInfo failed', errorMessage(e));
    return { heroActive: false };
  }
}

/** True when the SDK has been configured (real keys present + native). */
export function isPurchasesReady(): boolean {
  return configured;
}
