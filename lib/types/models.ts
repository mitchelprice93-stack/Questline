// Hand-written row types until `supabase gen types typescript --linked` runs.
// Once generated database types are available, these should be re-exported
// from the generated module so we have one source of truth.

import type { Difficulty, QuestTier } from '../engine/xp';

export type QuestClassification = 'daily' | 'side' | 'main' | 'legendary';
export type QuestStatus = 'active' | 'completed' | 'abandoned';
export type QuestRecurrence = 'daily' | 'weekly' | null;

export interface QuestObjective {
  text: string;
  completed: boolean;
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
  completed_at: string | null;
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
  created_at: string;
}

export interface Faction {
  id: string;
  user_id: string;
  name: string;
  real_world_domain: string;
  created_at: string;
}
