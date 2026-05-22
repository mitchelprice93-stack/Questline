// Reusable collapsible section. Renders a section header (title + arrow
// chevron) on top, children below; tapping the header toggles whether the
// children render. State is persisted per `id` in AsyncStorage so the
// chronicler's collapse/expand choices survive app restarts.
//
// Default state: expanded, the first time the user encounters a section
// they see all of it. From then on, AsyncStorage takes over.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Pressable as GHPressable } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

const KEY_PREFIX = '@questline/collapse:';

// Module-level cache of hydrated values, keyed by section id. AsyncStorage
// reads finish in <50ms but a 1-frame mismatch between "default" and
// "stored" still flashes on the first paint after a fresh launch. After the
// first hydration the value lives here so subsequent navigations (back to
// the character sheet from a quest, etc) are instant. Cleared when the
// process exits — we never need to bust this manually, AsyncStorage stays
// the source of truth.
const hydratedCache: Record<string, boolean> = {};

interface Props {
  /** Stable identifier for this section, used as the AsyncStorage key.
   *  Use kebab-case strings like "char-factions", "settings-audio", etc.
   *  Changing this on an existing section resets the user's state. */
  id: string;
  /** Title text shown in the header row, e.g. "Factions" or "Audio". */
  title: string;
  /** Optional content rendered to the right of the title (e.g. counters,
   *  Reorder buttons). Sits between the title and the chevron. */
  headerRight?: ReactNode;
  /** Optional className applied to the outer wrapper, lets the caller
   *  control bottom-margin / padding between sections. */
  className?: string;
  /** Optional override of the default-open state. Set to `false` if you
   *  want the section closed on the user's very first visit. */
  defaultExpanded?: boolean;
  children: ReactNode;
}

export function CollapsibleSection({
  id,
  title,
  headerRight,
  className,
  defaultExpanded = true,
  children,
}: Props) {
  // Cache hit: start with the user's stored value immediately, no flash.
  // Cache miss (first mount per session): start with defaultExpanded and
  // hydrate from AsyncStorage. The very first launch of the app will still
  // flash if the stored value disagrees with the default, but every
  // subsequent navigation hits the cache and is instant.
  const cached = hydratedCache[id];
  const [expanded, setExpanded] = useState(cached ?? defaultExpanded);

  useEffect(() => {
    if (id in hydratedCache) return;
    let cancelled = false;
    AsyncStorage.getItem(KEY_PREFIX + id)
      .then((v) => {
        if (cancelled) return;
        if (v === '0') {
          hydratedCache[id] = false;
          setExpanded(false);
        } else if (v === '1') {
          hydratedCache[id] = true;
          setExpanded(true);
        } else {
          hydratedCache[id] = defaultExpanded;
        }
      })
      .catch(() => {
        // Best-effort, fall back to whatever the in-memory state already is.
      });
    return () => {
      cancelled = true;
    };
  }, [id, defaultExpanded]);

  // Chevron rotates between -90° (collapsed, pointing right) and 0°
  // (expanded, pointing down). Reanimated avoids the bridge so the rotation
  // is smooth even mid-scroll.
  const rotation = useSharedValue(expanded ? 0 : -90);
  useEffect(() => {
    rotation.value = withTiming(expanded ? 0 : -90, {
      duration: 180,
      easing: Easing.out(Easing.cubic),
    });
  }, [expanded, rotation]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    hydratedCache[id] = next;
    // Fire-and-forget; we don't block the toggle on the write.
    void AsyncStorage.setItem(KEY_PREFIX + id, next ? '1' : '0');
  };

  return (
    <View className={className ?? 'mb-6'}>
      {/* Header row: tap anywhere on the row to toggle. GHPressable so
          the tap negotiates through gesture-handler and doesn't get the
          dead-tap responder issue when a sibling modal closes (same
          rationale as the Reorder buttons). */}
      <GHPressable onPress={toggle}>
        <View className="mb-2 flex-row items-center justify-between">
          <View className="flex-1 flex-row items-center">
            <Text className="font-display text-lg uppercase tracking-widest text-stone-700">
              {title}
            </Text>
          </View>
          <View className="flex-row items-center gap-3">
            {headerRight}
            <Animated.View style={chevronStyle}>
              <Text className="font-body text-xl text-stone-600">▾</Text>
            </Animated.View>
          </View>
        </View>
      </GHPressable>
      {/* Children only mount when expanded. Skipping render (rather than
          hiding via opacity/height) keeps the screen short and the layout
          clean, with no offscreen text reading by the screen reader. */}
      {expanded ? children : null}
    </View>
  );
}
