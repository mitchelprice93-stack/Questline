// First-launch tutorial state shared across the (main) layout.
//
// Holds the current step index and a registry of measured target rects so
// the spotlight overlay can draw a hole around any UI element a screen
// chooses to highlight. Screens publish their targets via TutorialTarget;
// the overlay reads them by id.
//
// Persistence (whether the user has seen the tutorial) lives in lib/tutorial.ts
// — this module is just the in-flight UI state.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { hasSeenTutorial, markTutorialSeen, resetTutorial } from './tutorial';

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TutorialContextValue {
  /** -1 when the tutorial is not running; 0..N-1 when it is. */
  step: number;
  isActive: boolean;
  start: () => Promise<void>;
  next: () => Promise<void>;
  skip: () => Promise<void>;
  /** Called by TutorialTarget whenever the wrapped element's layout changes.
   *  Pass null to clear (used on unmount). */
  registerTarget: (id: string, rect: TargetRect | null) => void;
  /** Read the most recent rect for an id, or null if unregistered. */
  getTarget: (id: string) => TargetRect | null;
}

const TutorialContext = createContext<TutorialContextValue | null>(null);

export function useTutorial(): TutorialContextValue {
  const ctx = useContext(TutorialContext);
  if (!ctx) throw new Error('useTutorial must be used inside TutorialProvider');
  return ctx;
}

interface ProviderProps {
  children: ReactNode;
  totalSteps: number;
  /** Called once when the tutorial is first triggered (fresh launch or replay).
   *  Use to navigate to the screen the first step expects. */
  onStart?: () => void;
}

export function TutorialProvider({ children, totalSteps, onStart }: ProviderProps) {
  const [step, setStep] = useState(-1);
  // Targets are kept in a plain object behind a state setter so consumers
  // re-render when a rect comes in. Holding raw refs would not trigger the
  // overlay to re-measure when the child finishes laying out.
  const [targets, setTargets] = useState<Record<string, TargetRect>>({});

  // Auto-start on first launch when the user hasn't seen the tutorial.
  useEffect(() => {
    let cancelled = false;
    void hasSeenTutorial().then((seen) => {
      if (cancelled || seen) return;
      setStep(0);
      onStart?.();
    });
    return () => {
      cancelled = true;
    };
  }, [onStart]);

  const start = useCallback(async () => {
    await resetTutorial();
    setStep(0);
    onStart?.();
  }, [onStart]);

  const next = useCallback(async () => {
    setStep((prev) => {
      const nextStep = prev + 1;
      if (nextStep >= totalSteps) {
        void markTutorialSeen();
        return -1;
      }
      return nextStep;
    });
  }, [totalSteps]);

  const skip = useCallback(async () => {
    await markTutorialSeen();
    setStep(-1);
  }, []);

  const registerTarget = useCallback((id: string, rect: TargetRect | null) => {
    setTargets((prev) => {
      if (rect === null) {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      }
      const existing = prev[id];
      if (
        existing &&
        existing.x === rect.x &&
        existing.y === rect.y &&
        existing.width === rect.width &&
        existing.height === rect.height
      ) {
        return prev;
      }
      return { ...prev, [id]: rect };
    });
  }, []);

  const getTarget = useCallback(
    (id: string): TargetRect | null => targets[id] ?? null,
    [targets],
  );

  const value = useMemo<TutorialContextValue>(
    () => ({
      step,
      isActive: step >= 0,
      start,
      next,
      skip,
      registerTarget,
      getTarget,
    }),
    [step, start, next, skip, registerTarget, getTarget],
  );

  return <TutorialContext.Provider value={value}>{children}</TutorialContext.Provider>;
}
