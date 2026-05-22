// Color-mode controller: light / dark / system, persisted across launches.
//
// The chronicler picks one of three preferences in Settings:
//   - 'system'   → mirror the OS theme. Reacts live to Appearance changes.
//   - 'light'    → force the parchment-by-sunlight palette (default look).
//   - 'dark'     → force the Midnight Chronicle palette (parchment by
//                  candlelight, bone ink, dimmed amber).
//
// Source of truth: AsyncStorage under KEY. On boot we hydrate the cache and
// apply the effective scheme to NativeWind so every dark: Tailwind variant
// resolves correctly. Hooks expose the preference + effective scheme to
// settings UI and any component that needs to branch on it explicitly
// (e.g. the cinematic intro that loads a different background asset).

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme as useNwColorScheme } from 'nativewind';
import { useEffect, useState } from 'react';
import { Appearance, type ColorSchemeName } from 'react-native';

export type ColorModePreference = 'system' | 'light' | 'dark';
export type EffectiveColorMode = 'light' | 'dark';

const KEY = '@questline/color-mode';

// Module-level cache so re-renders / re-mounts read synchronously instead
// of flashing the default until AsyncStorage resolves. Hydrated once at
// app boot via `initColorMode()`.
let cachedPreference: ColorModePreference = 'system';
let hydrated = false;
// JS-side listeners that want to be notified when the chronicler changes
// the preference. NativeWind already handles the className flip; this is
// for code paths that need to branch in plain JS (image picks, etc).
const listeners = new Set<(pref: ColorModePreference) => void>();

function notify(pref: ColorModePreference) {
  for (const l of listeners) l(pref);
}

/** Resolve a preference + the current system theme into the actual
 *  light/dark scheme to render with. */
function resolveEffective(
  pref: ColorModePreference,
  system: ColorSchemeName,
): EffectiveColorMode {
  if (pref === 'light') return 'light';
  if (pref === 'dark') return 'dark';
  return system === 'dark' ? 'dark' : 'light';
}

/** Read the persisted preference (cache-first). Resolves to 'system' on
 *  first launch, since the cache default is 'system'. */
export async function getColorModePreference(): Promise<ColorModePreference> {
  if (hydrated) return cachedPreference;
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') {
      cachedPreference = v;
    }
  } catch {
    // ignored, fall through with default 'system'
  }
  hydrated = true;
  return cachedPreference;
}

/** Persist a new preference. NativeWind's scheme is updated by the
 *  caller (typically via the useColorMode hook below), so this function
 *  alone won't flip the UI; it only stores the value. */
export async function setColorModePreference(pref: ColorModePreference): Promise<void> {
  cachedPreference = pref;
  hydrated = true;
  try {
    await AsyncStorage.setItem(KEY, pref);
  } catch {
    // best-effort: if write fails the in-memory cache still holds for this session
  }
  notify(pref);
}

/** Wire up the chronicler's chosen scheme at app boot. Call once from
 *  the root layout. Returns the resolved effective scheme so the caller
 *  can also drive things like the status bar style synchronously on
 *  first render. */
export async function initColorMode(
  setScheme: (s: EffectiveColorMode) => void,
): Promise<EffectiveColorMode> {
  const pref = await getColorModePreference();
  const sys = Appearance.getColorScheme();
  const effective = resolveEffective(pref, sys);
  setScheme(effective);
  return effective;
}

/** Hook for components that need to read or write the preference. The
 *  returned `effective` value is what NativeWind has applied; use it to
 *  branch any non-Tailwind code (image selection, native overlays). */
export function useColorMode(): {
  preference: ColorModePreference;
  effective: EffectiveColorMode;
  setPreference: (next: ColorModePreference) => Promise<void>;
} {
  const { colorScheme, setColorScheme } = useNwColorScheme();
  const [preference, setLocalPreference] = useState<ColorModePreference>(cachedPreference);

  useEffect(() => {
    // Hydrate from disk if we haven't yet, and reflect into local state.
    let cancelled = false;
    void getColorModePreference().then((p) => {
      if (!cancelled) setLocalPreference(p);
    });
    // Subscribe to module-level preference changes so all mounted hooks
    // stay in sync (Settings flips it; the rest of the tree picks it up).
    const onChange = (p: ColorModePreference) => setLocalPreference(p);
    listeners.add(onChange);
    return () => {
      cancelled = true;
      listeners.delete(onChange);
    };
  }, []);

  // When in 'system' mode, react live to OS appearance changes.
  useEffect(() => {
    if (preference !== 'system') return;
    const sub = Appearance.addChangeListener(({ colorScheme: sys }) => {
      setColorScheme(sys === 'dark' ? 'dark' : 'light');
    });
    return () => sub.remove();
  }, [preference, setColorScheme]);

  // Whenever the preference changes (or once on first mount), reconcile
  // NativeWind's scheme to match.
  useEffect(() => {
    const sys = Appearance.getColorScheme();
    setColorScheme(resolveEffective(preference, sys));
  }, [preference, setColorScheme]);

  const setPreference = async (next: ColorModePreference) => {
    await setColorModePreference(next);
    setLocalPreference(next);
    // setColorScheme is also reached via the effect above, but call here
    // too so the flip feels instant to the tapping component.
    const sys = Appearance.getColorScheme();
    setColorScheme(resolveEffective(next, sys));
  };

  const effective: EffectiveColorMode = colorScheme === 'dark' ? 'dark' : 'light';
  return { preference, effective, setPreference };
}
