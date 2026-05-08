// Phase 5.x — parchment surface.
//
// Layered background that sits behind every (main) screen. parchment-bg
// is the full-bleed warm vellum canvas; parchment-frame layers on top to
// add a burnt/torn edge feel. Both are bundled assets so this is purely
// cosmetic — no network, no permissions.

import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

const BG = require('../assets/ui/parchment-bg.png');
const FRAME = require('../assets/ui/parchment-frame.png');

/** Absolute-fill stack of parchment-bg + parchment-frame. Used as the
 *  first child of every (main) screen's root View. */
export function ParchmentBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <Image source={BG} contentFit="cover" style={StyleSheet.absoluteFillObject} />
      <Image
        source={FRAME}
        contentFit="cover"
        style={[StyleSheet.absoluteFillObject, { opacity: 0.55 }]}
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
