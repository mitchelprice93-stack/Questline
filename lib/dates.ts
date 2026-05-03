// Phase 3.6/4-ish — flexible deadline parsing + display.
//
// Users type deadlines in any human format ("May 2nd 2026", "5/2/26",
// "next Friday", "tomorrow at 5pm"). chrono-node does the parsing; we
// normalize to ISO 8601 timestamptz for storage, and format back to readable
// strings for display.

import * as chrono from 'chrono-node';

export type DeadlineUrgency = 'overdue' | 'urgent' | 'soon' | 'normal';

/** Parse loose human input → Date, or null if unparseable / blank. */
export function parseDeadline(input: string, reference: Date = new Date()): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = chrono.parseDate(trimmed, reference, { forwardDate: true });
  return parsed ?? null;
}

/**
 * Format an ISO deadline for display: "May 2, 2026" if midnight-aligned,
 * else "May 2, 2026 at 6:00 PM". Returns the raw value if it can't be
 * parsed (defensive — DB might hold something we didn't expect).
 */
export function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const dateStr = d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const hasTimeOfDay = d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
  if (!hasTimeOfDay) return dateStr;
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dateStr} at ${timeStr}`;
}

/**
 * "Due tomorrow", "Due in 5 days", "Overdue · 2 days ago", "Due today".
 * Returns null when there's no deadline.
 */
export function formatDeadlineRelative(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diffMs = d.getTime() - now.getTime();
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days < -1) return `Overdue · ${-days} days ago`;
  if (days === -1) return 'Overdue · yesterday';
  if (days === 0) return 'Due today';
  if (days === 1) return 'Due tomorrow';
  return `Due in ${days} days`;
}

/**
 * Urgency tier for color-coding.
 *   overdue: past
 *   urgent : within 3 days
 *   soon   : within 7 days
 *   normal : everything farther out
 *   null   : no deadline / unparseable
 */
export function deadlineUrgency(
  iso: string | null,
  now: Date = new Date(),
): DeadlineUrgency | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const diffMs = d.getTime() - now.getTime();
  const days = diffMs / (1000 * 60 * 60 * 24);
  if (days < 0) return 'overdue';
  if (days < 3) return 'urgent';
  if (days < 7) return 'soon';
  return 'normal';
}

/**
 * Tailwind class fragments keyed by urgency. Caller composes them into
 * className strings for borders, backgrounds, and text.
 */
export const urgencyClasses: Record<DeadlineUrgency, { border: string; text: string }> = {
  overdue: { border: 'border-red-500/60', text: 'text-red-300' },
  urgent: { border: 'border-orange-500/60', text: 'text-orange-300' },
  soon: { border: 'border-amber-500/40', text: 'text-amber-300' },
  normal: { border: 'border-stone-800', text: 'text-stone-300' },
};

// ---- Recurring quest period helpers ----------------------------------------
//
// All period math runs in UTC so the client matches the server-side
// `date_trunc` checks in complete_quest. A small timezone mismatch around
// midnight is acceptable — the client uses these to disable buttons; the
// RPC is canonical and will reject a stale request with P0003.

/** UTC YYYY-MM-DD for a Date. */
function utcDayKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/** UTC Monday-of-the-week-containing-d as YYYY-MM-DD. ISO weeks start Mon. */
function utcWeekKey(d: Date): string {
  const day = d.getUTCDay(); // 0 = Sunday
  // Postgres date_trunc('week') treats Monday as the start of the week. JS
  // getUTCDay returns 0 for Sunday — convert to a 0-based offset from Monday.
  const offsetFromMonday = (day + 6) % 7;
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - offsetFromMonday),
  );
  return utcDayKey(monday);
}

/**
 * True when the last_completed_at timestamp falls in the same period (day
 * for 'daily', ISO week for 'weekly') as `now`. Returns false for one-shot
 * quests and quests that have never been completed.
 */
export function isCompletedThisPeriod(
  recurrence: 'daily' | 'weekly' | null,
  lastCompletedAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!recurrence || !lastCompletedAt) return false;
  const last = new Date(lastCompletedAt);
  if (isNaN(last.getTime())) return false;
  if (recurrence === 'daily') return utcDayKey(last) === utcDayKey(now);
  return utcWeekKey(last) === utcWeekKey(now);
}

/**
 * Short label for a recurring quest's period status, e.g. "Done today",
 * "Done this week", or null when the quest is ready to be completed.
 */
export function recurrenceStatusLabel(
  recurrence: 'daily' | 'weekly' | null,
  lastCompletedAt: string | null,
  now: Date = new Date(),
): string | null {
  if (!isCompletedThisPeriod(recurrence, lastCompletedAt, now)) return null;
  return recurrence === 'daily' ? 'Done today' : 'Done this week';
}
