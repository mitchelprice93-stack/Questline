// Wrap any UI element in <TutorialTarget id="…"> to publish its on-screen
// rect to the TutorialProvider. The spotlight overlay then reads the rect
// by id when its current step asks to highlight that element.
//
// The wrapper renders a transparent View around its children so layout +
// position are measurable; it adds no visual styling of its own.

import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import type { ReactNode } from 'react';

import { useTutorial } from '../lib/tutorial-context';

interface Props {
  id: string;
  children: ReactNode;
  /** Pass false to skip registration (useful when a target only matters
   *  while the tutorial is on a particular step). Defaults to true. */
  enabled?: boolean;
}

export function TutorialTarget({ id, children, enabled = true }: Props) {
  const { registerTarget, isActive } = useTutorial();
  const ref = useRef<View>(null);

  const measure = useCallback(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node) return;
    // measureInWindow gives screen-relative coords, which is what we want
    // for the overlay (it lives at the (main) layout root).
    node.measureInWindow((x, y, width, height) => {
      // Some platforms briefly report 0×0 during transitions; ignore those
      // so we don't draw a tiny hole at the origin.
      if (width <= 0 || height <= 0) return;
      registerTarget(id, { x, y, width, height });
    });
  }, [id, enabled, registerTarget]);

  // Re-measure when the tutorial activates — the target may have been
  // mounted before the overlay decided to highlight it.
  useEffect(() => {
    if (!isActive || !enabled) return;
    // Defer to the next frame so layout has settled.
    const handle = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(handle);
  }, [isActive, enabled, measure]);

  // Clean up on unmount so the overlay doesn't keep a stale rect around.
  useEffect(() => {
    return () => registerTarget(id, null);
  }, [id, registerTarget]);

  return (
    <View ref={ref} onLayout={measure} collapsable={false}>
      {children}
    </View>
  );
}
