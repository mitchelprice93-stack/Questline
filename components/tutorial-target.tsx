// Wrap any UI element in <TutorialTarget id="…"> to publish its on-screen
// rect to the TutorialProvider. The spotlight overlay then reads the rect
// by id when its current step asks to highlight that element.
//
// The wrapper renders a transparent View around its children so layout +
// position are measurable; it adds no visual styling of its own.
//
// Positions are measured RELATIVE TO THE TUTORIAL ANCHOR — the (main)
// layout's flex-1 wrapper View, which is also the overlay's direct parent.
// This guarantees the spotlight paints exactly where the target sits,
// regardless of safe-area insets, edge-to-edge offsets, or any other
// wrapper math between the window root and the overlay's container.

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
  const { registerTarget, isActive, anchorRef, step } = useTutorial();
  const ref = useRef<View>(null);

  const measure = useCallback(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node) return;
    const anchor = anchorRef.current;
    // Measure target in window-space, then subtract the anchor's
    // window-space position to get coords RELATIVE TO THE ANCHOR. Since
    // the overlay sits inside the same anchor with absoluteFillObject,
    // those coords are exactly where it paints.
    if (anchor) {
      anchor.measureInWindow((ox, oy) => {
        node.measureInWindow((x, y, width, height) => {
          if (width <= 0 || height <= 0) return;
          registerTarget(id, {
            x: x - ox,
            y: y - oy,
            width,
            height,
          });
        });
      });
      return;
    }
    // Fallback when anchor hasn't mounted yet — use raw window coords.
    // This races on first launch but self-corrects on the next layout
    // pass once the anchor is set.
    node.measureInWindow((x, y, width, height) => {
      if (width <= 0 || height <= 0) return;
      registerTarget(id, { x, y, width, height });
    });
  }, [id, enabled, registerTarget, anchorRef]);

  // Re-measure when the tutorial activates AND on every step advance.
  //
  // The step-change re-measure was added to fix tablet first-time spotlights
  // that landed on stale positions. By the time the user has clicked Next
  // to advance the tutorial, any layout settling (font loading, async data,
  // tab transitions) is done, so re-measuring per step catches the final
  // resting position even on slower hardware where the initial mount-time
  // measurement caught the screen mid-settle.
  useEffect(() => {
    if (!isActive || !enabled) return;
    const handle = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(handle);
  }, [isActive, step, enabled, measure]);

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
