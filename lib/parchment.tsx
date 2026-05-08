// Phase 5.x — parchment surface.
//
// Layered background that sits behind every (main) screen. parchment-bg
// is the full-bleed warm vellum canvas; parchment-frame layers on top to
// add a burnt/torn edge feel. Both are bundled assets so this is purely
// cosmetic — no network, no permissions.

import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

const BG = require('../assets/ui/parchment-bg.png');
const FRAME = require('../assets/ui/parchment-frame.png');

/**
 * Mount once in the (main) layout, behind the Tabs. Each screen renders
 * with a transparent root so this canvas shows through; tab bar and
 * absolutely-positioned overlays sit above it.
 */
export function ParchmentBackground() {
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
      <Image source={BG} contentFit="cover" style={StyleSheet.absoluteFillObject} />
      {/* Frame on top at reduced opacity — adds the burnt-edge
          framing without darkening the center too much. */}
      <Image
        source={FRAME}
        contentFit="cover"
        style={[StyleSheet.absoluteFillObject, { opacity: 0.55 }]}
      />
    </View>
  );
}
