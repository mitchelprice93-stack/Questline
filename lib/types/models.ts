// Hand-written row types until `supabase gen types typescript --linked` runs.
// Once generated database types are available, these should be re-exported
// from the generated module so we have one source of truth.

import type { Difficulty, QuestTier } from '../engine/xp';

export type QuestClassification = 'daily' | 'side' | 'main' | 'legendary';
export type QuestStatus = 'active' | 'completed' | 'abandoned';
export type QuestRecurrence = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom' | null;
/** For `recurrence = 'custom'` only, both fields are required (non-null,
 *  positive int) when recurrence is custom and null otherwise. The DB
 *  enforces this invariant via a CHECK constraint. */
export type QuestRecurrenceUnit = 'days' | 'weeks' | 'months';
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
  /** Custom cadence: how many units between completions. Null unless recurrence='custom'. */
  recurrence_interval: number | null;
  /** Custom cadence: the unit ('days', 'weeks', 'months'). Null unless recurrence='custom'. */
  recurrence_unit: QuestRecurrenceUnit | null;
  /** Weekly recurrence: subset of weekdays this quest is due (0=Sun..6=Sat).
   *  Null means "due once per week, any day". Non-null means each selected
   *  day is its own due instance. Only set when recurrence='weekly'. */
  recurrence_weekdays: number[] | null;
  /** Monthly recurrence: subset of month-days this quest is due (1..31).
   *  Null means "due once per month, any day". Non-null means each selected
   *  day is its own due instance. Only set when recurrence='monthly'. */
  recurrence_month_days: number[] | null;
  streak_count: number;
  deadline: string | null;
  /** Set when a one-shot quest reaches `completed` status. */
  completed_at: string | null;
  /** For recurring quests: timestamp of the most recent successful completion. */
  last_completed_at: string | null;
  /** Set when the quest was abandoned. */
  abandoned_at: string | null;
  /** Non-null timestamp = quest is pinned to the top of the board. Most-
   *  recently-pinned sorts first within the pinned section. Set to null to
   *  unpin. Pinning is independent of all other sort/group settings. */
  pinned_at: string | null;
  /** How many percentage points completing this quest advances its linked
   *  campaign. 1-100; null iff campaign_id is null. The DB enforces the
   *  pairing invariant via CHECK constraint. */
  campaign_contribution_pct: number | null;
  /** Pre-declared buff this quest will grant on completion if its condition
   *  is satisfied. All four fields move together, either every one is set
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
  /** Chronicler's preferred sort position. Lower = higher on the list.
   *  Persists across sessions; reorder via drag-and-drop on the character
   *  sheet writes a fresh ordering. */
  display_order: number;
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
  /** Chronicler's preferred sort position. Lower = higher on the list. */
  display_order: number;
  created_at: string;
}

/** A "Personal" achievement, one per campaign the chronicler has finished.
 *  Title and description are AI-generated by the Archivist when a campaign's
 *  progress crosses 100%. Unique on campaign_id (one trophy per arc, ever);
 *  deleting the campaign cascades. */
export interface CampaignAchievement {
  id: string;
  user_id: string;
  campaign_id: string;
  title: string;
  description: string;
  /** When the chronicler earned this. For live completions this is now();
   *  for the backfill it's set to the campaign's last quest-completion
   *  timestamp so gallery dates line up with actual progress. */
  earned_at: string;
  created_at: string;
}
