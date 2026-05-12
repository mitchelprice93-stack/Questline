// Hand-written row types until `supabase gen types typescript --linked` runs.
// Once generated database types are available, these should be re-exported
// from the generated module so we have one source of truth.

import type { Difficulty, QuestTier } from '../engine/xp';

export type QuestClassification = 'daily' | 'side' | 'main' | 'legendary';
export type QuestStatus = 'active' | 'completed' | 'abandoned';
export type QuestRecurrence = 'daily' | 'weekly' | null;
export type GrantedBuffCondition = 'on_complete' | 'on_time' | 'all_objectives';

export interface QuestObjective {
  text: string;
  completed: boolean;
  // Index signature lets QuestObjective[] flow through supabase-js's Json
  // typing without a manual cast. The fields above are the only meaningful
  // ones at runtime; this just satisfies the structural check.
  [key: string]: string | boolean | undefined;
}

export interface Quest {
  id: string;
  user_id: string;
  faction_id: string | null;
  campaign_id: string | null;
  title: string;
  description: string | null;
  objectives: QuestObjective[];
  tier: QuestTier;
  classification: QuestClassification;
  xp_reward: number;
  status: QuestStatus;
  recurrence: QuestRecurrence;
  streak_count: number;
  deadline: string | null;
  /** Set when a one-shot quest reaches `completed` status. */
  completed_at: string | null;
  /** For recurring quests: timestamp of the most recent successful completion. */
  last_completed_at: string | null;
  /** Set when the quest was abandoned. */
  abandoned_at: string | null;
  /** Pre-declared buff this quest will grant on completion if its condition
   *  is satisfied. All four fields move together — either every one is set
   *  or every one is null. */
  granted_buff_name: string | null;
  granted_buff_description: string | null;
  granted_buff_pct: number | null;
  granted_buff_condition: GrantedBuffCondition | null;
  created_at: string;
}

export interface Profile {
  id: string;
  display_name: string | null;
  character_name: string | null;
  character_title: string | null;
  level: number;
  total_xp: number;
  difficulty: Difficulty;
  /** Last time the user invoked +rest. Drives the 7-day cooldown. */
  last_rest_at: string | null;
  /** Last time the user opened the app (session.user.id observed by AuthProvider).
   *  Drives the "Resurrected" achievement (login after 30-day absence). */
  last_seen_at: string | null;
  created_at: string;
}

// ---- Achievements (v1.1) --------------------------------------------------

export interface AchievementEarnedRow {
  id: string;
  user_id: string;
  achievement_code: string;
  metadata: Record<string, unknown> | null;
  earned_at: string;
}

export interface AchievementProgressRow {
  user_id: string;
  achievement_code: string;
  current_value: number;
  target_value: number;
  last_updated: string;
}

export interface Faction {
  id: string;
  user_id: string;
  name: string;
  real_world_domain: string;
  /** User-editable reputation title within this faction (e.g. "Veteran"
   *  for the US Navy). Defaults to "Initiate" until renamed. */
  reputation_title: string;
  /** Total quests completed for this faction. Auto-incremented by a
   *  trigger on quest completion; never edited by the client. */
  reputation_count: number;
  created_at: string;
}

export interface Campaign {
  id: string;
  user_id: string;
  faction_id: string | null;
  arc_name: string;
  real_world_goal: string;
  progress_pct: number;
  status: 'active' | 'completed' | 'abandoned';
  created_at: string;
}
