// useAnimatedNumber — smoothly tick a value from its previous toward a
// new target whenever the target changes. Returns a continuous float;
// callers Math.round it for integer text display, OR pass the float
// straight into a derived value (e.g. progress-bar width) so the visual
// glides smoothly even when the rounded text snaps.
//
// Built on requestAnimationFrame rather than Reanimated because Text
// doesn't accept animated style props for its content; the simplest
// portable thing is a state-driven counter.
//
// Initial mount: no animation. Subsequent target changes: linear over
// `duration` (linear feels smoother for counting because every integer
// flip takes the same time — eased curves bunch flips at one end and
// the user perceives that as "jumpy"). Target changes mid-animation
// cancel and restart from the current displayed value.

import { useEffect, useRef, useState } from 'react';

export function useAnimatedNumber(target: number, duration = 900): number {
  const [displayed, setDisplayed] = useState(target);
  // Mirror of `displayed` for the effect to read without subscribing —
  // adding `displayed` to the dep array would re-run the effect every
  // frame (we call setDisplayed inside it).
  const displayedRef = useRef(target);
  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    const from = displayedRef.current;
    const to = target;
    if (from === to) return;

    const start = performance.now();
    let raf = 0;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / duration);
      // Linear: constant rate from `from` to `to`. Snap to exact `to` on
      // the final frame so we don't end on a float-fuzz value like
      // 1499.9998 that rounds to 1500 but holds a stale ref value.
      const value = t >= 1 ? to : from + (to - from) * t;
      setDisplayed(value);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [target, duration]);

  return displayed;
}
