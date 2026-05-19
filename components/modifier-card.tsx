// Animated card for a single buff or debuff on the Character Sheet.
//
// On mount: slides + fades in (FadeInDown), then a one-shot glow pulse
// fades over the surface for ~700ms. Buffs glow amber, debuffs glow red.
// Existing cards on a re-render don't replay the animation because
// React preserves the component instance across renders when the key
// (modifier.id) is stable; useEffect with [] deps fires once per mount.
//
// New buffs / debuffs that just landed in the modifiers table mount
// fresh on the next refresh and animate in. Cards already on screen
// stay still.

import { useEffect } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import type { ActiveModifier } from '../lib/debuffs';

interface Props {
  modifier: ActiveModifier;
  /** Optional remaining-duration label (only meaningful for buffs with
   *  expires_at). Caller computes this, keeps the card display-only. */
  remainingLabel?: string | null;
}

export function ModifierCard({ modifier, remainingLabel }: Props) {
  const isBuff = modifier.type === 'buff';
  const glow = useSharedValue(0);

  useEffect(() => {
    // Pulse: 0 → peak → 0 over ~700ms, with a small initial delay so
    // the FadeInDown lands first and the glow trails it.
    glow.value = withDelay(
      120,
      withSequence(
        withTiming(0.55, { duration: 220 }),
        withTiming(0, { duration: 480 }),
      ),
    );
  }, [glow]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Animated.View
      entering={FadeInDown.duration(380).springify().damping(14)}
      className={`overflow-hidden rounded-md border bg-amber-50/40 px-4 py-3 ${
        isBuff ? 'border-emerald-900/40' : 'border-red-900/40'
      }`}
    >
      {/* Glow overlay, absolute fill behind the content. Buff = amber,
          debuff = red. Pointer-events none so taps still land. */}
      <Animated.View
        pointerEvents="none"
        className={`absolute inset-0 ${isBuff ? 'bg-amber-400' : 'bg-red-500'}`}
        style={glowStyle}
      />
      <View className="flex-row items-baseline justify-between">
        <Text className="font-body-medium text-xl text-stone-900">{modifier.name}</Text>
        <Text
          className={`font-body text-base ${
            isBuff ? 'text-emerald-800' : 'text-red-700'
          }`}
        >
          {modifier.xp_modifier_pct >= 0 ? '+' : ''}
          {modifier.xp_modifier_pct}%
        </Text>
      </View>
      {modifier.effect_description ? (
        <Text className="font-body text-base text-stone-700">
          {modifier.effect_description}
        </Text>
      ) : null}
      {remainingLabel ? (
        <Text className="mt-1 font-body text-base text-stone-700">{remainingLabel}</Text>
      ) : null}
    </Animated.View>
  );
}
