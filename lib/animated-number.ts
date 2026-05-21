// useAnimatedNumber, smoothly tick a value from its previous toward a
// new target whenever the target changes. Returns a continuous float;
// callers Math.round it for integer text display, OR pass the float
// straight into a derived value (e.g. progress-bar width) so the visual
// glides smoothly even when the rounded text snaps.
//
// Built on requestAnimationFrame rather than Reanimated because Text
// doesn't accept animated style props for its content; the simplest
// portable thing is a state-driven counter.
//
// `ready` (third arg, defaults true): pass false while the caller is
// still loading data so the hook doesn't snap to a fallback like 0
// and then animate from 0 to the real value the moment data arrives.
//
// `persistKey` (fourth arg, optional): module-level cache key. When
// provided, the hook persists the most recently SETTLED value across
// mounts. Behavior on re-entry:
//   * If the cache exists and matches the new target -> no animation
//     (chronicler hadn't gained any XP while away).
//   * If the cache exists and differs from the target -> animate from
//     cached value to target (chronicler earned XP while away, see it
//     settle in on the sheet).
//   * If no cache exists (first-ever mount) -> snap to target.
//
// Without persistKey the hook still works, you just lose the "animate
// in changes earned while away" behavior, every fresh mount snaps.
//
// Target changes mid-animation cancel and restart from the current
// displayed value. Linear curve feels smoother for counting because
// every integer flip takes the same time, eased curves bunch flips
// at one end and the user perceives that as "jumpy".

import { useEffect, useRef, useState } from 'react';

// Module-level cache. Keyed by an arbitrary string the caller provides
// (typically scoped per user + per metric, e.g. `xp:${userId}`). Lives
// for the lifetime of the JS bundle, which matches a single app session
// closely enough that "what the user last saw" is meaningfully tracked.
const persistedValues = new Map<string, number>();

export function useAnimatedNumber(
  target: number,
  duration = 900,
  ready = true,
  persistKey?: string,
): number {
  // Seed the displayed state from cache when available. This is what lets
  // a stale value from a previous mount serve as the animation's "from"
  // when the user returns and a fresh target loads.
  const [displayed, setDisplayed] = useState(() => {
    if (persistKey && persistedValues.has(persistKey)) {
      return persistedValues.get(persistKey)!;
    }
    return target;
  });
  // Mirror of `displayed` for the effect to read without subscribing -
  // adding `displayed` to the dep array would re-run the effect every
  // frame (we call setDisplayed inside it).
  const displayedRef = useRef(displayed);
  // True after the first ready=true transition. Used to distinguish a
  // first-time-ever mount (no cache, no prior value to animate from)
  // from a returning mount (cache hit means animate from cached value).
  const primedRef = useRef(false);
  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    // Hold whatever's displayed while caller hasn't signaled data is
    // ready. Avoids animating fallback-to-real transitions.
    if (!ready) return;

    const from = displayedRef.current;
    const to = target;
    const isFirstReady = !primedRef.current;
    primedRef.current = true;

    if (from === to) {
      // Already where we should be. Keep cache fresh so future mounts
      // know the user has seen this value.
      if (persistKey) persistedValues.set(persistKey, to);
      return;
    }

    // First-time-ever mount with no cache: snap, don't animate the
    // load transition. Cache exists OR this isn't the first ready ->
    // animate (the chronicler should see the change settle in).
    const hadCacheOnMount = persistKey != null && persistedValues.has(persistKey);
    const shouldAnimate = !isFirstReady || hadCacheOnMount;

    if (!shouldAnimate) {
      displayedRef.current = to;
      setDisplayed(to);
      if (persistKey) persistedValues.set(persistKey, to);
      return;
    }

    const start = performance.now();
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / duration);
      // Snap to exact `to` on the final frame so we don't end on a
      // float-fuzz value like 1499.9998 that rounds to 1500 but holds
      // a stale ref value.
      const value = t >= 1 ? to : from + (to - from) * t;
      setDisplayed(value);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else if (persistKey) {
        // Persist only once the animation has fully landed. If the user
        // leaves mid-animation, next mount replays from the previously
        // settled value, which is at worst a benign repeat of the same
        // ticker. Not worth writing every frame.
        persistedValues.set(persistKey, to);
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [target, duration, ready, persistKey]);

  return displayed;
}
