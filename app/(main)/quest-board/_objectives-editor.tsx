// Shared objectives editor used by both the new-quest review screen and the
// quest detail edit mode. Leading underscore keeps expo-router from treating
// this as a route.
//
// Reorder UX: each row has a 4-dot handle on the left. Touch and hold the
// handle, then drag the row up or down to its new position. We use a fixed
// ROW_HEIGHT for swap-threshold math so this stays simple and predictable
// across multiline objective text (the editor is rarely longer than 5-7
// items, so per-row height measurement isn't worth the complexity here).

import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, Text, TextInput, View } from 'react-native';
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

import type { QuestObjective } from '../../../lib/types/models';

interface Props {
  objectives: QuestObjective[];
  onChange: (next: QuestObjective[]) => void;
  disabled?: boolean;
}

// Used for both the row's fixed height and the swap-threshold math. Keep in
// sync with the row's actual rendered height. Adjusted slightly upward from
// a single-line measurement to give multiline objectives breathing room.
const ROW_HEIGHT = 56;

export function ObjectivesEditor({ objectives, onChange, disabled }: Props) {
  const update = (idx: number, partial: Partial<QuestObjective>) => {
    onChange(objectives.map((o, i) => (i === idx ? { ...o, ...partial } : o)));
  };
  const remove = (idx: number) => {
    onChange(objectives.filter((_, i) => i !== idx));
  };
  const add = () => {
    onChange([...objectives, { text: '', completed: false }]);
  };
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const arr = [...objectives];
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    onChange(arr);
  };

  return (
    <View>
      {objectives.map((obj, idx) => (
        <ObjectiveRow
          key={idx}
          obj={obj}
          idx={idx}
          count={objectives.length}
          disabled={disabled}
          onToggleComplete={() => update(idx, { completed: !obj.completed })}
          onChangeText={(text) => update(idx, { text })}
          onRemove={() => remove(idx)}
          onReorder={reorder}
        />
      ))}
      <Pressable
        onPress={add}
        disabled={disabled}
        className="mt-1 rounded-md border border-dashed border-stone-700 px-3 py-2 active:bg-amber-50/40"
      >
        <Text className="text-center font-body text-xl text-stone-700">+ Add objective</Text>
      </Pressable>
    </View>
  );
}

interface RowProps {
  obj: QuestObjective;
  idx: number;
  count: number;
  disabled?: boolean;
  onToggleComplete: () => void;
  onChangeText: (text: string) => void;
  onRemove: () => void;
  onReorder: (from: number, to: number) => void;
}

function ObjectiveRow({
  obj,
  idx,
  count,
  disabled,
  onToggleComplete,
  onChangeText,
  onRemove,
  onReorder,
}: RowProps) {
  // translateY: visual offset while dragging this row.
  // dragging: 1 when active, used to lift z-index above siblings.
  // displaced: visual offset for OTHER rows shifting to make space.
  const translateY = useSharedValue(0);
  const dragging = useSharedValue(0);
  const displaced = useSharedValue(0);

  // While ANY row is being dragged, every other row listens to the active
  // drag's "intended target index" and shifts up/down to make a visual gap.
  // We piggyback on a module-level shared value (activeDrag) so all sibling
  // rows can react without prop-drilling. The dragged row stays put because
  // its translateY is already controlled by the gesture.
  useAnimatedReaction(
    () => activeDrag.value,
    (state) => {
      if (!state || state.from === idx) {
        // Either no drag, or this is the dragged row itself.
        displaced.value = withTiming(0, { duration: 120 });
        return;
      }
      const { from, to } = state;
      // If this row sits between the source and target, slide it the
      // opposite direction by one row-height.
      if (from < to && idx > from && idx <= to) {
        displaced.value = withTiming(-ROW_HEIGHT, { duration: 120 });
      } else if (from > to && idx < from && idx >= to) {
        displaced.value = withTiming(ROW_HEIGHT, { duration: 120 });
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
      // Compute intended landing index based on drag distance.
      const shift = Math.round(e.translationY / ROW_HEIGHT);
      const to = Math.max(0, Math.min(count - 1, idx + shift));
      if (!activeDrag.value || activeDrag.value.to !== to) {
        activeDrag.value = { from: idx, to };
      }
    })
    .onEnd((e) => {
      const shift = Math.round(e.translationY / ROW_HEIGHT);
      const to = Math.max(0, Math.min(count - 1, idx + shift));
      dragging.value = 0;
      activeDrag.value = null;
      if (to !== idx) {
        // Reorder commit: snap translateY back instantly rather than spring.
        // React keys rows by array index, so springing back would animate on
        // the row that now sits at the OLD index (a different objective after
        // the swap), which looks wrong. The displaced sibling rows already
        // made a visual gap exactly where the dragged item lands, so a snap
        // here is unjarring: the dragged item appears in its slot, and the
        // siblings finish their displacement animation back to 0.
        translateY.value = 0;
        runOnJS(onReorder)(idx, to);
      } else {
        // No reorder, gentle spring back to the original slot is correct
        // here because the same component instance stays at the same index.
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
    <Animated.View
      style={animatedStyle}
      className="mb-2 flex-row items-center gap-2"
    >
      <GestureDetector gesture={pan}>
        <View
          className={`items-center justify-center rounded-md border border-stone-700 bg-amber-50/40 px-2 py-2 ${
            count > 1 ? 'active:bg-amber-100/60' : 'opacity-40'
          }`}
          accessibilityLabel="Drag handle. Hold and drag to reorder."
          accessibilityRole="adjustable"
        >
          {/* 6-dot handle, the classic Material drag idiom. */}
          <MaterialCommunityIcons name="drag-vertical" size={22} color="#78716c" />
        </View>
      </GestureDetector>
      <Pressable
        onPress={onToggleComplete}
        disabled={disabled}
        className="rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 active:bg-amber-100/60"
      >
        <Text className="font-body text-stone-700">{obj.completed ? '☑' : '☐'}</Text>
      </Pressable>
      <TextInput
        value={obj.text}
        onChangeText={onChangeText}
        placeholder="Step…"
        placeholderTextColor="#57534e"
        editable={!disabled}
        multiline
        className="flex-1 rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 font-body text-stone-900"
      />
      <Pressable
        onPress={onRemove}
        disabled={disabled}
        className="rounded-md border border-stone-800 bg-amber-50/40 px-3 py-2 active:bg-amber-100/60"
      >
        <Text className="font-body text-stone-700">×</Text>
      </Pressable>
    </Animated.View>
  );
}

// Module-level shared value broadcasting "which row is being dragged and
// where it intends to land". Sibling rows subscribe via useAnimatedReaction
// to slide out of the way. Reset to null on gesture end. Only one editor
// instance is mounted at a time (one screen visible), so a single global
// state is safe and avoids drilling shared values through every row.
const activeDrag = makeMutable<{ from: number; to: number } | null>(null);
