// Read-only access to xp_log for the XP History screen. Append-only by
// policy; only the service role can delete (via the claude-proxy / cron
// paths). A foreign-key join pulls each row's quest title for display.

import { asError } from './errors';
import { supabase } from './supabase';

export interface XpLogEntry {
  id: string;
  quest_id: string | null;
  xp_change: number;
  reason: string;
  created_at: string;
  /** Joined from quests. Null if the quest was deleted (FK is on-delete-set-null). */
  quest_title: string | null;
}

interface RawXpLogRow {
  id: string;
  quest_id: string | null;
  xp_change: number;
  reason: string;
  created_at: string;
  quests: { title: string } | { title: string }[] | null;
}

export async function listXpLog(limit = 200): Promise<XpLogEntry[]> {
  const { data, error } = await supabase
    .from('xp_log')
    .select('id, quest_id, xp_change, reason, created_at, quests(title)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw asError(error);
  return ((data ?? []) as RawXpLogRow[]).map((row) => {
    // The supabase-js join can return either an object or an array shape
    // depending on the relationship cardinality; quest_id → quests is
    // many-to-one, so treat both shapes defensively.
    const qt = Array.isArray(row.quests) ? row.quests[0]?.title : row.quests?.title;
    return {
      id: row.id,
      quest_id: row.quest_id,
      xp_change: row.xp_change,
      reason: row.reason,
      created_at: row.created_at,
      quest_title: qt ?? null,
    };
  });
}

/**
 * Render an xp_log row's reason+context as a single readable line.
 * Examples:
 *   ('quest_complete', 'Mow the lawn')   → "Quest completed: Mow the lawn"
 *   ('streak_bonus_7', 'Daily standup')  → "Streak milestone (7), Daily standup"
 *   ('quest_complete', null)             → "Quest completed (deleted quest)"
 */
export function describeXpLogReason(reason: string, questTitle: string | null): string {
  if (reason === 'quest_complete') {
    return questTitle ? `Quest completed: ${questTitle}` : 'Quest completed (deleted quest)';
  }
  if (reason.startsWith('streak_bonus_')) {
    const n = reason.split('_').pop();
    const ctx = questTitle ? `, ${questTitle}` : '';
    return `Streak milestone (${n})${ctx}`;
  }
  return reason;
}
