// Reputation retitle — fires after a major or legendary quest tied to a
// faction completes. The Archivist proposes a fresh in-voice title that
// reflects the specific deed, and we persist it via the existing
// updateFaction helper.
//
// This is a best-effort enhancement: if the AI call fails (rate limit,
// timeout, etc.) we silently skip. The completion flow has already
// shown the user their XP / buff / level changes — a missing title
// upgrade isn't worth surfacing as an error.

import { callClaudeProxy, ClaudeProxyError } from './ai';
import { updateFaction } from './character-sheet';
import type { QuestTier } from './engine/xp';
import { supabase } from './supabase';
import type { Faction, Quest } from './types/models';

interface RetitlePayload {
  faction: {
    name: string;
    real_world_domain: string;
    current_title: string;
    quests_completed: number;
  };
  quest: {
    title: string;
    description: string | null;
    tier: QuestTier;
    classification: Quest['classification'];
  };
}

const RETITLE_TIMEOUT_MS = 12_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

export interface RetitleResult {
  /** The faction's new title, persisted server-side. */
  newTitle: string;
  /** What it was before, so the UI can show "X → Y". */
  previousTitle: string;
}

/**
 * Returns true when this completion warrants a retitle: the quest hit
 * a notable tier and was tied to a faction. Recurring completions count
 * once on the active→completed flip; the caller controls when to invoke.
 */
export function shouldRetitle(quest: Pick<Quest, 'tier' | 'faction_id'>): boolean {
  if (!quest.faction_id) return false;
  return quest.tier === 'major' || quest.tier === 'legendary';
}

/**
 * Ask the Archivist for a new reputation_title for the quest's faction based
 * on the deed just completed, and persist it. Returns null on any failure.
 *
 * Call AFTER completeQuest so the faction's reputation_count reflects the
 * just-incremented value the trigger applied.
 */
export async function retitleFactionFromQuest(
  factionId: string,
  quest: Pick<Quest, 'title' | 'description' | 'tier' | 'classification'>,
): Promise<RetitleResult | null> {
  // Fetch the latest faction row — post-trigger so reputation_count is
  // current. RLS gates this to the caller's own factions.
  const { data, error } = await supabase
    .from('factions')
    .select('*')
    .eq('id', factionId)
    .maybeSingle();
  if (error || !data) {
    console.warn('[retitle] faction lookup failed', error);
    return null;
  }
  const faction = data as Faction;

  const payload: RetitlePayload = {
    faction: {
      name: faction.name,
      real_world_domain: faction.real_world_domain,
      current_title: faction.reputation_title,
      quests_completed: faction.reputation_count,
    },
    quest: {
      title: quest.title,
      description: quest.description,
      tier: quest.tier,
      classification: quest.classification,
    },
  };

  try {
    const result = await withTimeout(
      callClaudeProxy<{ new_reputation_title: string }>('reputation_retitle', payload),
      RETITLE_TIMEOUT_MS,
      'reputation_retitle',
    );
    const proposed = result.data.new_reputation_title.trim();
    if (!proposed) return null;
    // Only skip if the AI returned EXACTLY the same string we already
    // have. Case differences ("Initiate" vs "initiate") are kept as a
    // change so the user gets feedback that something happened.
    if (proposed === faction.reputation_title.trim()) return null;
    await updateFaction(faction.id, { reputation_title: proposed });
    return { newTitle: proposed, previousTitle: faction.reputation_title };
  } catch (e) {
    if (e instanceof ClaudeProxyError && e.isRateLimited()) {
      console.warn('[retitle] rate-limited; skipping', e.message);
    } else {
      console.warn('[retitle] failed; skipping', e);
    }
    return null;
  }
}
