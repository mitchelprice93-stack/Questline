// Phase 5.x — parchment surface.
//
// Layered background that sits behind every (main) screen. parchment-bg
// is the full-bleed warm vellum canvas; parchment-frame layers on top to
// add a burnt/torn edge feel. Both are bundled assets so this is purely
// cosmetic — no network, no permissions.

import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

// Single-layer parchment — the frame asset already carries the parchment
// center plus burnt edges, so we don't need parchment-bg as a separate
// canvas. (parchment-bg.png is kept on disk for archival but isn't
// imported.) Scaled 1.05 to crop the heavy black burnt corners slightly
// and let the page breathe a touch wider on screen.
const FRAME = require('../assets/ui/parchment-frame.png');

/** Absolute-fill parchment frame. Used as the first child of every
 *  (main) screen's root View. */
export function ParchmentBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <Image
        source={FRAME}
        contentFit="cover"
        style={[StyleSheet.absoluteFillObject, { transform: [{ scale: 1.05 }] }]}
      />
    </View>
  );
}

/**
 * Wrap a screen's content with a parchment canvas behind it. Each (main)
 * screen draws its own copy — that way scenes can stay opaque (no tab
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
  return (
    <View className="flex-1 bg-amber-50">
      <ParchmentBackground />
      {children}
    </View>
  );
}
