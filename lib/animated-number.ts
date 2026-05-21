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
// `ready` flag (third arg, defaults to true): pass false while the
// caller is still loading data so the hook doesn't snap to a fallback
// like 0 and then animate from 0 to the real value the moment data
// arrives. When ready flips false -> true, the hook jumps to the
// current target without animating. After that first jump, subsequent
// target changes animate normally. This is what kills the "every
// time you open the Character sheet, the level and XP tick up from 0"
// behavior even when no actual XP was gained.
//
// Target changes mid-animation cancel and restart from the current
// displayed value. Linear curve feels smoother for counting because
// every integer flip takes the same time, eased curves bunch flips
// at one end and the user perceives that as "jumpy".

import { useEffect, useRef, useState } from 'react';

export function useAnimatedNumber(target: number, duration = 900, ready = true): number {
  const [displayed, setDisplayed] = useState(target);
  // Mirror of `displayed` for the effect to read without subscribing -
  // adding `displayed` to the dep array would re-run the effect every
  // frame (we call setDisplayed inside it).
  const displayedRef = useRef(target);
  // Tracks whether the caller has flipped ready=true at least once.
  // The first ready transition is a "data just arrived" event and we
  // snap to the target. Subsequent target changes animate.
  const primedRef = useRef(false);
  useEffect(() => {
    displayedRef.current = displayed;
  }, [displayed]);

  useEffect(() => {
    // Hold whatever's displayed while caller hasn't signaled data is
    // ready. Avoids animating fallback-to-real transitions.
    if (!ready) return;

    // First time becoming ready: snap to target, no animation.
    if (!primedRef.current) {
      primedRef.current = true;
      displayedRef.current = target;
      setDisplayed(target);
      return;
    }

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
      // Snap to exact `to` on the final frame so we don't end on a
      // float-fuzz value like 1499.9998 that rounds to 1500 but holds
      // a stale ref value.
      const value = t >= 1 ? to : from + (to - from) * t;
      setDisplayed(value);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [target, duration, ready]);

  return displayed;
}
