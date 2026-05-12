// In-process pub-sub for newly-granted achievements.
//
// Trigger functions publish a list of just-earned codes; the AchievementSurface
// component (mounted once at the (main) layout root) subscribes and renders
// the right surface for each one — toast for common/uncommon/rare, full-screen
// cinematic for legendary.
//
// Kept dependency-free on purpose so the engine modules can import it without
// pulling React in. A plain Set of listeners is enough; the surface drains
// the queue when it's ready to render.

import type { Achievement } from './engine/achievements';

export interface EarnedAchievement {
  achievement: Achievement;
  metadata: Record<string, unknown> | null;
  earnedAt: string;
}

type Listener = (events: EarnedAchievement[]) => void;

const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishAchievements(events: EarnedAchievement[]): void {
  if (events.length === 0) return;
  for (const l of listeners) {
    try {
      l(events);
    } catch (e) {
      console.warn('[achievement-feed] listener threw', e);
    }
  }
}
