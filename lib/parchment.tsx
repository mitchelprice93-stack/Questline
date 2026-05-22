// Phase 5.x, parchment surface.
//
// Layered background that sits behind every (main) screen. parchment-bg
// is the full-bleed warm vellum canvas; parchment-frame layers on top to
// add a burnt/torn edge feel. Both are bundled assets so this is purely
// cosmetic, no network, no permissions.
//
// Midnight Chronicle: in dark mode we keep the same parchment texture
// (so the lore still reads through) but overlay a dark stone scrim plus
// a faint candle-warm radial tint. The asset stays singular; the tinting
// is pure CSS. If we ever ship a dedicated night-vellum asset, swap the
// FRAME require behind a useColorScheme branch here.

import { Image } from 'expo-image';
import { useColorScheme } from 'nativewind';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

// Single-layer parchment, the frame asset already carries the parchment
// center plus burnt edges, so we don't need parchment-bg as a separate
// canvas. (parchment-bg.png is kept on disk for archival but isn't
// imported.) Scaled 1.05 to crop the heavy black burnt corners slightly
// and let the page breathe a touch wider on screen.
const FRAME = require('../assets/ui/parchment-frame.png');

/** Absolute-fill parchment frame. Used as the first child of every
 *  (main) screen's root View. In dark mode a stone-scrim overlay sits
 *  on top of the parchment so the asset reads as "candlelit night
 *  vellum" rather than "noon sun parchment". */
export function ParchmentBackground() {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === 'dark';
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <Image
        source={FRAME}
        contentFit="cover"
        style={[StyleSheet.absoluteFillObject, { transform: [{ scale: 1.05 }] }]}
      />
      {isDark ? (
        // 78% stone scrim over the parchment image, tuned by eye: dark
        // enough that the textured parchment reads as deep-stained vellum
        // without losing the burnt-edge detail of the frame. Tweak the
        // alpha here if the lore-y feel drifts toward "generic dark mode".
        <View
          style={[
            StyleSheet.absoluteFillObject,
            { backgroundColor: 'rgba(28, 25, 23, 0.78)' },
          ]}
        />
      ) : null}
    </View>
  );
}

/**
 * Wrap a screen's content with a parchment canvas behind it. Each (main)
 * screen draws its own copy, that way scenes can stay opaque (no tab
 * cross-fade overlap), but the canvas reliably shows through every time.
 *
 * Use as the outermost element of any screen that wants the parchment look:
 *
 *   return (
 *     <ParchmentScreen>
 *       <ScrollView ...>...</ScrollView>
 *     </ParchmentScreen>
 *   );
 */
export function ParchmentScreen({ children }: { children: ReactNode }) {
  // bg-amber-50 in light, bg-stone-900 underneath in dark, so when the
  // parchment image is loading the screen doesn't flash white. Once the
  // image is on screen the ParchmentBackground's scrim takes over.
  return (
    <View className="flex-1 bg-amber-50 dark:bg-stone-900">
      <ParchmentBackground />
      {children}
    </View>
  );
}
