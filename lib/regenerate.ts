// Client-side wrappers for the three "regenerate this in-voice name" AI
// endpoints. Each one is a thin call to the claude-proxy edge function and
// returns just the string we need to write back to the DB. Errors bubble
// up so the UI can show a toast and let the chronicler try again.

import { callClaudeProxy } from './ai';

/**
 * Ask the Archivist for a fresh character title given the chronicler's
 * current profile. The payload must include current_title so the AI knows
 * what NOT to echo. Returns the new title string.
 */
export async function regenerateCharacterTitle(payload: {
  name: string;
  current_title: string | null;
  background: string | null;
  proficiencies: string | null;
  life_summary: string | null;
}): Promise<string> {
  const result = await callClaudeProxy<{ new_character_title: string }>(
    'regenerate_title',
    payload,
  );
  return result.data.new_character_title.trim();
}

/** Fresh in-voice name for a single faction, derived from its real-world
 *  domain. Server enforces the "different from current" rule via the prompt. */
export async function regenerateFactionName(payload: {
  real_world_domain: string;
  current_name: string;
}): Promise<string> {
  const result = await callClaudeProxy<{ new_name: string }>(
    'regenerate_faction_name',
    payload,
  );
  return result.data.new_name.trim();
}

/** Fresh in-voice arc name for a single campaign, derived from its
 *  real-world goal. */
export async function regenerateCampaignArcName(payload: {
  real_world_goal: string;
  current_arc_name: string;
}): Promise<string> {
  const result = await callClaudeProxy<{ new_arc_name: string }>(
    'regenerate_campaign_name',
    payload,
  );
  return result.data.new_arc_name.trim();
}
