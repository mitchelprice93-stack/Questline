// Phase 2.4 — AI quest generation.
//
// User types a plain-language endeavor, the Archivist returns a forged quest
// (title, description, objectives, classification, tier, tactical warnings).
// The deterministic engine still owns XP — code computes xp_reward from the
// AI's suggested_tier via xpForTier, never trusting the AI to set XP itself.

import { callClaudeProxy, ClaudeProxyError } from './ai';
import type { QuestTier } from './engine/xp';
import { getActiveQuestCount, getCurrentProfile, listFactions } from './profile';
import type { QuestClassification, QuestObjective } from './types/models';

export interface QuestGenerationPayload {
  /** The chronicler's plain-language description of the endeavor. */
  input: string;
  context: {
    character_name: string | null;
    character_title: string | null;
    level: number;
    factions: { name: string }[];
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
  /** True when the AI call failed and we fell back to a stub. */
  fromFallback: boolean;
}

// 15s — generous for a Sonnet round-trip. Spec only pins 6s for character
// creation; quest generation has no fixed timeout but must feel responsive.
const AI_TIMEOUT_MS = 15_000;

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
  const [profile, factions, active_quest_count] = await Promise.all([
    getCurrentProfile(),
    listFactions(),
    getActiveQuestCount(),
  ]);
  return {
    character_name: profile?.character_name ?? null,
    character_title: profile?.character_title ?? null,
    level: profile?.level ?? 1,
    factions: factions.map((f) => ({ name: f.name })),
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
      }>('quest_generation', payload),
      AI_TIMEOUT_MS,
      'quest_generation',
    );
    return { ...result.data, fromFallback: false };
  } catch (e) {
    if (e instanceof ClaudeProxyError && e.isRateLimited()) {
      console.warn('quest_generation rate-limited; using fallback', e.message);
    } else {
      console.warn('quest_generation failed; using fallback', e);
    }
    return templatedFallback(trimmed);
  }
}
