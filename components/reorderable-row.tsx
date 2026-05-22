// Wraps an arbitrary child in a draggable row with a 6-dot drag handle on
// the left. Long-press the handle (~150ms) and pan vertically to reorder.
// On release the parent's onReorder(from, to) fires; the parent commits
// the array change and the row settles into its new position.
//
// Pattern lifted from _objectives-editor.tsx so the UX is identical to
// the objectives reorder. Differences:
//   - Generic content via {children}, the parent controls everything to
//     the right of the handle.
//   - Configurable rowHeight per use site (faction/campaign cards are
//     taller than objective rows).
//   - Module-level activeDrag is scoped per "list key" so multiple
//     reorderable lists on the same screen don't interfere with each
//     other (factions + campaigns on character sheet).

import type { ReactNode } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  makeMutable,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

interface Props {
  /** Identifier for the list this row belongs to. Lets multiple lists
   *  coexist on the same screen without their drag states bleeding into
   *  each other. Use a stable string like "factions" or "campaigns". */
  listKey: string;
  idx: number;
  count: number;
  /** Approximate height of this row in px. Drives swap-threshold math
   *  (drag past half a row to bump the target index). Doesn't have to be
   *  exact, the tighter it is, the more accurate the visual response. */
  rowHeight: number;
  disabled?: boolean;
  /** Called on gesture end with the source and target indices. Indices
   *  may be equal when the chronicler released without moving past the
   *  swap threshold; the parent can ignore those cases. */
  onReorder: (from: number, to: number) => void;
  children: ReactNode;
}

// Module-level active-drag state, keyed by listKey so two reorderable
// lists on the same screen don't cross-talk. Each entry tracks the
// dragged row's from/to indices while a drag is in progress.
type ActiveDrag = { from: number; to: number } | null;
const activeDragByList = new Map<string, ReturnType<typeof makeMutable<ActiveDrag>>>();

function getActiveDrag(listKey: string) {
  let v = activeDragByList.get(listKey);
  if (!v) {
    v = makeMutable<ActiveDrag>(null);
    activeDragByList.set(listKey, v);
  }
  return v;
}

export function ReorderableRow({
  listKey,
  idx,
  count,
  rowHeight,
  disabled,
  onReorder,
  children,
}: Props) {
  const activeDrag = getActiveDrag(listKey);

  const translateY = useSharedValue(0);
  const dragging = useSharedValue(0);
  const displaced = useSharedValue(0);

  // Siblings slide out of the way to show where the dragged row will land.
  useAnimatedReaction(
    () => activeDrag.value,
    (state) => {
      if (!state || state.from === idx) {
        displaced.value = withTiming(0, { duration: 120 });
        return;
      }
      const { from, to } = state;
      if (from < to && idx > from && idx <= to) {
        displaced.value = withTiming(-rowHeight, { duration: 120 });
      } else if (from > to && idx < from && idx >= to) {
        displaced.value = withTiming(rowHeight, { duration: 120 });
      } else {
        displaced.value = withTiming(0, { duration: 120 });
      }
    },
  );

  const pan = Gesture.Pan()
    .enabled(!disabled && count > 1)
    .activateAfterLongPress(150)
    .onStart(() => {
      dragging.value = 1;
      activeDrag.value = { from: idx, to: idx };
    })
    .onUpdate((e) => {
      translateY.value = e.translationY;
      const shift = Math.round(e.translationY / rowHeight);
      const to = Math.max(0, Math.min(count - 1, idx + shift));
      if (!activeDrag.value || activeDrag.value.to !== to) {
        activeDrag.value = { from: idx, to };
      }
    })
    .onEnd((e) => {
      const shift = Math.round(e.translationY / rowHeight);
      const to = Math.max(0, Math.min(count - 1, idx + shift));
      dragging.value = 0;
      activeDrag.value = null;
      if (to !== idx) {
        // Snap (no spring) on reorder commit, same rationale as the
        // objectives editor: a spring would animate on the wrong React
        // fiber after the array shifts since rows are keyed by index.
        translateY.value = 0;
        runOnJS(onReorder)(idx, to);
      } else {
        translateY.value = withSpring(0, { damping: 18, stiffness: 220 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value + displaced.value }],
    zIndex: dragging.value ? 10 : 0,
    elevation: dragging.value ? 6 : 0,
    opacity: dragging.value ? 0.95 : 1,
  }));

  return (
    <Animated.View style={animatedStyle} className="flex-row items-center gap-2">
      <GestureDetector gesture={pan}>
        <View
          className={`items-center justify-center rounded-md border border-stone-700 bg-amber-50/40 px-2 py-2 ${
            count > 1 ? 'active:bg-amber-100/60' : 'opacity-40'
          }`}
          accessibilityLabel="Drag handle. Hold and drag to reorder."
          accessibilityRole="adjustable"
        >
          <MaterialCommunityIcons name="drag-vertical" size={22} color="#78716c" />
        </View>
      </GestureDetector>
      <View className="flex-1">{children}</View>
    </Animated.View>
  );
}
