// useAnimatedNumber — smoothly tick a displayed integer from its previous
// value to a new target whenever the target changes. Built on
// requestAnimationFrame rather than Reanimated because Text doesn't accept
// animated style props for its content; the simplest portable thing is a
// state-driven counter.
//
// Initial mount: no animation. Subsequent target changes: ease-out cubic
// over `duration`. Target changes mid-animation cancel and restart from
// the current displayed value.

import { useEffect, useRef, useState } from 'react';

export function useAnimatedNumber(target: number, duration = 800): number {
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
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      const value = Math.round(from + (to - from) * eased);
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
