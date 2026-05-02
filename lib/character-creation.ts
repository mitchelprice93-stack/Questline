// Phase 2.3 — character creation flow.
//
// Drives the AI call (with timeout + templated fallback) and the atomic
// apply_character_creation RPC.

import { callClaudeProxy, ClaudeProxyError } from './ai';
import { assessStartingLevel, LEVEL_THRESHOLDS } from './engine/xp';
import { asError } from './errors';
import { supabase } from './supabase';

export interface CharacterCreationInput {
  /** Required. The chronicler's chosen name. */
  name: string;
  /** Optional. A title the user supplied themselves; the AI may override. */
  title: string | null;
  /** Free-form background lore. */
  background: string;
  /** Plain-language workplaces / employments. */
  factions: string[];
  /** Free-form education, training, accomplishments. */
  proficiencies: string;
  /** Free-form description of current state — drives starting level fallback. */
  life_summary: string;
  /** Plain-language goals / current projects. */
  campaigns: string[];
  /** Optional inventory; pass null or empty string to skip. */
  inventory: string | null;
}

interface AIFaction {
  name: string;
  real_world_domain: string;
}

interface AICampaign {
  arc_name: string;
  real_world_goal: string;
}

export interface CharacterSheetResult {
  character_title: string;
  starting_level: number;
  factions: AIFaction[];
  campaigns: AICampaign[];
  first_quest_hook: string;
  /** True when the AI call failed and we fell back to a templated sheet. */
  fromFallback: boolean;
}

const AI_TIMEOUT_MS = 6_000;
const FALLBACK_TITLE = 'The Wanderer';
const FALLBACK_QUEST_HOOK =
  'A blank page awaits the first inscription — choose any endeavor and let the Tome record it.';

/**
 * Wraps a promise with a hard timeout. The promise keeps running in the
 * background but the caller stops waiting on it.
 */
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

function templatedFallback(input: CharacterCreationInput): CharacterSheetResult {
  const startingLevel = assessStartingLevel(input.life_summary, input.campaigns.length);
  return {
    character_title: input.title?.trim() || FALLBACK_TITLE,
    starting_level: startingLevel,
    factions: input.factions
      .map((f) => f.trim())
      .filter(Boolean)
      .map((domain) => ({ name: domain, real_world_domain: domain })),
    campaigns: input.campaigns
      .map((c) => c.trim())
      .filter(Boolean)
      .map((goal) => ({ arc_name: goal, real_world_goal: goal })),
    first_quest_hook: FALLBACK_QUEST_HOOK,
    fromFallback: true,
  };
}

/**
 * Calls the AI with a 6-second hard timeout. On timeout, rate-limit, or any
 * error, returns a templated fallback so the user is never blocked.
 */
export async function generateCharacterSheet(
  input: CharacterCreationInput,
): Promise<CharacterSheetResult> {
  try {
    const result = await withTimeout(
      callClaudeProxy<{
        character_title: string;
        starting_level: number;
        factions: AIFaction[];
        campaigns: AICampaign[];
        first_quest_hook: string;
      }>('character_creation', input),
      AI_TIMEOUT_MS,
      'character_creation',
    );
    return { ...result.data, fromFallback: false };
  } catch (e) {
    // Distinguish rate-limit from other failures only for logging — both fall back.
    if (e instanceof ClaudeProxyError && e.isRateLimited()) {
      console.warn('character_creation rate-limited; using fallback', e.message);
    } else {
      console.warn('character_creation failed; using fallback', e);
    }
    return templatedFallback(input);
  }
}

/**
 * Persists the parsed character sheet via the atomic apply_character_creation
 * RPC. The RPC enforces the "1 per lifetime" rule and is transactional.
 *
 * Sets total_xp to the cumulative threshold for the starting level, so
 * calculateLevel(profile.total_xp).level === starting_level.
 */
export async function applyCharacterSheet(
  name: string,
  sheet: CharacterSheetResult,
): Promise<void> {
  const safeLevel = Math.min(
    Math.max(Math.floor(sheet.starting_level), 1),
    LEVEL_THRESHOLDS.length,
  );
  const totalXp = LEVEL_THRESHOLDS[safeLevel - 1] ?? 0;

  const { error } = await supabase.rpc('apply_character_creation', {
    p_character_name: name,
    p_character_title: sheet.character_title,
    p_starting_level: safeLevel,
    p_total_xp: totalXp,
    p_factions: sheet.factions,
    p_campaigns: sheet.campaigns,
  });
  if (error) throw asError(error);
}
