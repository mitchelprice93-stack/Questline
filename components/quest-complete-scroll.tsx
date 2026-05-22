// Lore-themed "Quest Complete" popup. Replaces the generic Alert.alert that
// used to fire after a non-level-up completion. The card unfurls open (scaleY
// 0 -> 1 with an ease-out-back bounce, like a scroll dropping open) and rolls
// closed on dismiss (scaleY 1 -> 0 with an ease-in, then unmounts).
//
// All textual flavor lives in here so the caller just passes structured data.
// Pure presentation, the parent handles the awaited promise via onDismiss.

import { useEffect } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { formatXp } from '../lib/numbers';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export interface QuestCompleteData {
  /** Net XP awarded this completion (after modifiers). */
  xpChange: number;
  /** Total XP after this completion. Pass for one-shots, omit for recurring
   *  where the streak line carries the weight instead. */
  newTotalXp?: number;
  /** Recurring quest streak after this completion. Omit for one-shots. */
  streak?: number;
  /** Bonus XP awarded for hitting a streak milestone. Omit when 0. */
  milestoneBonus?: number;
  /** Net modifier percent applied to the base XP. Positive = buffs, negative
   *  = debuffs. Omit when 0. */
  modifierPct?: number;
  /** Name of a granted buff earned, if the condition was met. */
  buffGranted?: string | null;
}

interface Props {
  data: QuestCompleteData | null;
  onDismiss: () => void;
}

export function QuestCompleteScroll({ data, onDismiss }: Props) {
  // scale: 0 (rolled up) to 1 (fully unfurled). Drives both the open and
  // close animations. Mounted only when data != null so the entrance plays
  // every time the popup opens.
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (data) {
      // Unfurl. Slight back-easing gives a "snap open" feel like a scroll
      // dropping under its own weight.
      scale.value = withTiming(1, {
        duration: 480,
        easing: Easing.out(Easing.back(0.7)),
      });
      opacity.value = withTiming(1, { duration: 240 });
    }
  }, [data, scale, opacity]);

  const close = () => {
    // Roll the scroll back up, then unmount via onDismiss. Faster than the
    // open so the user's tap feels responsive.
    opacity.value = withTiming(0, { duration: 180 });
    scale.value = withTiming(
      0,
      { duration: 280, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onDismiss)();
      },
    );
  };

  const scrollStyle = useAnimatedStyle(() => ({
    transform: [{ scaleY: scale.value }],
    opacity: opacity.value,
  }));

  if (!data) return null;

  const { xpChange, newTotalXp, streak, milestoneBonus, modifierPct, buffGranted } = data;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close}>
      <Pressable
        onPress={close}
        className="flex-1 items-center justify-center bg-stone-950/70 px-6"
      >
        {/* Inner Pressable swallows taps on the card so accidental taps on
            the card body don't dismiss; only the backdrop or the explicit
            button do. */}
        <Pressable onPress={() => undefined}>
          <Animated.View
            style={scrollStyle}
            className="w-full max-w-md rounded-md border-2 border-amber-900 bg-amber-50 p-6"
          >
            {/* Top flourish */}
            <Text className="mb-1 text-center font-display text-xs uppercase tracking-[0.4em] text-amber-800">
              The Tome inscribes
            </Text>
            <Text className="mb-4 text-center font-display text-3xl text-stone-900">
              Quest Complete
            </Text>

            {/* XP centerpiece */}
            <View className="mb-3 items-center">
              <Text className="font-display-bold text-4xl text-amber-700">
                +{formatXp(xpChange)} XP
              </Text>
            </View>

            {/* Compact stat lines. Each row only renders when relevant. Single
                "label: value" form, in keeping with the chronicler's request
                for terse stat sheet readouts rather than narrated prose. */}
            {streak && streak > 0 ? (
              <Text className="mb-1 text-center font-body text-lg text-stone-700">
                Streak: <Text className="font-body-medium text-amber-800">{streak}</Text>
              </Text>
            ) : null}

            {modifierPct !== undefined && modifierPct !== 0 ? (
              <Text className="mb-1 text-center font-body text-lg text-stone-700">
                Applied Buffs:{' '}
                <Text
                  className={`font-body-medium ${
                    modifierPct > 0 ? 'text-emerald-800' : 'text-red-800'
                  }`}
                >
                  {modifierPct > 0 ? '+' : ''}
                  {modifierPct}%
                </Text>
              </Text>
            ) : null}

            {milestoneBonus && milestoneBonus > 0 ? (
              <Text className="mb-1 text-center font-body text-lg text-stone-700">
                Milestone Bonus:{' '}
                <Text className="font-body-medium text-amber-800">+{milestoneBonus} XP</Text>
              </Text>
            ) : null}

            {buffGranted ? (
              <Text className="mb-1 text-center font-body text-lg text-stone-700">
                Boon Earned:{' '}
                <Text className="font-body-medium text-emerald-800">{buffGranted}</Text>
              </Text>
            ) : null}

            {/* Dismiss button */}
            <Pressable
              onPress={close}
              className="mt-5 rounded-md bg-amber-700 px-4 py-3 active:bg-amber-800"
            >
              <Text className="text-center font-display text-xl text-amber-50">
                Onward
              </Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
