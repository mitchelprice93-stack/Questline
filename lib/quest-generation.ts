// Phase 2.4 — AI quest generation.
//
// User types a plain-language endeavor, the Archivist returns a forged quest
// (title, description, objectives, classification, tier, tactical warnings).
// The deterministic engine still owns XP — code computes xp_reward from the
// AI's suggested_tier via xpForTier, never trusting the AI to set XP itself.

import { callClaudeProxy, ClaudeProxyError } from './ai';
import type { QuestTier } from './engine/xp';
import { getActiveQuestCount, getCurrentProfile, listCampaigns, listFactions } from './profile';
import type {
  GrantedBuffCondition,
  QuestClassification,
  QuestObjective,
} from './types/models';

export interface GeneratedBuff {
  name: string;
  description: string;
  pct: number;
  condition: GrantedBuffCondition;
}

export interface QuestGenerationPayload {
  /** The chronicler's plain-language description of the endeavor. */
  input: string;
  context: {
    character_name: string | null;
    character_title: string | null;
    level: number;
    factions: { name: string }[];
    /** Active campaigns the AI may pre-select if the quest aligns. Empty when the user has none. */
    campaigns: { id: string; arc_name: string; real_world_goal: string }[];
    active_quest_count: number;
  };
}

export interface GeneratedQuest {
  title: string;
  description: string;
  objectives: QuestObjective[];
  classification: QuestClassification;
  suggested_tier: QuestTier;
  tactical_warnings: string[];
  /** A boon the chronicler earns if they meet the buff's condition on completion. */
  granted_buff: GeneratedBuff;
  /** Active-campaign id the AI thinks this quest advances, if any. Validated
   *  against the loaded list — null when the AI returned empty string, an
   *  unknown id, or there were no active campaigns to choose from. */
  suggested_campaign_id: string | null;
  /** True when the AI call failed and we fell back to a stub. */
  fromFallback: boolean;
}

// 30s — Sonnet 4.6 with thinking disabled usually returns in 3-8s, but
// we've seen occasional 15-25s spikes under Anthropic load. The user
// stays on a loading spinner the whole time, so erring on the side of
// "wait for the real answer" beats silently dropping to the templated
// fallback.
const AI_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Loads the per-call character context the AI uses to anchor its response.
 * Runs the three queries in parallel.
 */
export async function loadQuestGenerationContext(): Promise<QuestGenerationPayload['context']> {
  const [profile, factions, campaigns, active_quest_count] = await Promise.all([
    getCurrentProfile(),
    listFactions(),
    listCampaigns('active'),
    getActiveQuestCount(),
  ]);
  return {
    character_name: profile?.character_name ?? null,
    character_title: profile?.character_title ?? null,
    level: profile?.level ?? 1,
    factions: factions.map((f) => ({ name: f.name })),
    campaigns: campaigns.map((c) => ({
      id: c.id,
      arc_name: c.arc_name,
      real_world_goal: c.real_world_goal,
    })),
    active_quest_count,
  };
}

function templatedFallback(input: string): GeneratedQuest {
  // Use the user's input verbatim as the title/description and pick a
  // middle-of-the-road tier and classification. The user can adjust on review.
  const trimmed = input.trim();
  const title = trimmed.length > 60 ? trimmed.slice(0, 57) + '…' : trimmed;
  return {
    title: title || 'A new endeavor',
    description: trimmed,
    objectives: [],
    classification: 'side',
    suggested_tier: 'standard',
    tactical_warnings: ['The Archivist was silent — refine this quest as you see fit.'],
    // Generic buff so even fallback quests carry a small boon — the user
    // can edit or remove it on the review screen.
    granted_buff: {
      name: "Wanderer's Stride",
      description: 'A small surge of momentum carries into the next deed.',
      pct: 5,
      condition: 'on_complete',
    },
    suggested_campaign_id: null,
    fromFallback: true,
  };
}

/**
 * Calls the AI with a 6-second hard timeout. On timeout, rate-limit, or any
 * error, returns a templated fallback. The user can always edit before saving.
 */
export async function generateQuest(input: string): Promise<GeneratedQuest> {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Input cannot be empty');

  const context = await loadQuestGenerationContext();
  const payload: QuestGenerationPayload = { input: trimmed, context };

  try {
    const result = await withTimeout(
      callClaudeProxy<{
        title: string;
        description: string;
        objectives: QuestObjective[];
        classification: QuestClassification;
        suggested_tier: QuestTier;
        tactical_warnings: string[];
        granted_buff: GeneratedBuff;
        suggested_campaign_id: string;
      }>('quest_generation', payload),
      AI_TIMEOUT_MS,
      'quest_generation',
    );
    // The AI returns empty string when no campaign fits. Guard against
    // hallucinated ids by re-checking against the context we passed in.
    const validCampaignIds = new Set(context.campaigns.map((c) => c.id));
    const rawId = result.data.suggested_campaign_id;
    const suggested_campaign_id = rawId && validCampaignIds.has(rawId) ? rawId : null;
    return { ...result.data, suggested_campaign_id, fromFallback: false };
  } catch (e) {
    if (e instanceof ClaudeProxyError && e.isRateLimited()) {
      console.warn('quest_generation rate-limited; using fallback', e.message);
    } else {
      console.warn('quest_generation failed; using fallback', e);
    }
    return templatedFallback(trimmed);
  }
}
