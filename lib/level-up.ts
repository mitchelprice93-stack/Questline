// Phase 5.x — level-up narration.
//
// When a quest completion crosses a level threshold, the LevelUpTakeover
// fetches a 2-3 sentence Archivist-voice summary of what tipped the
// chronicler over. Rendered as text now; ElevenLabs voice playback comes
// in a follow-up (Phase 3.4 deferred).

import { callClaudeProxy, ClaudeProxyError } from './ai';

export interface LevelUpContext {
  /** Character's chosen name (or 'Wanderer' if none). */
  character_name: string;
  character_title: string | null;
  old_level: number;
  new_level: number;
  /** Title of the quest whose completion crossed the threshold. */
  triggering_quest_title: string;
  /** Tier of the triggering quest. */
  triggering_quest_tier: string;
  /** Total XP awarded by the triggering completion (already includes
   *  modifiers and milestone bonuses). */
  xp_change: number;
  /** New cumulative XP after the completion. */
  new_total_xp: number;
  /** New streak count if the trigger was a recurring quest (else 0). */
  new_streak: number;
  /** Bonus XP awarded for hitting a streak milestone (else 0). */
  milestone_bonus: number;
  /** Name of any buff this completion granted. */
  buff_granted: string | null;
}

const TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function fallbackNarration(ctx: LevelUpContext): string {
  // The Archivist was silent, but a level-up screen with no narration would
  // feel hollow. Compose a generic line off-line so the takeover still has
  // something to say.
  if (ctx.milestone_bonus > 0 && ctx.new_streak > 0) {
    return `Your hand has not faltered for ${ctx.new_streak} turns. The Tome takes notice.`;
  }
  if (ctx.triggering_quest_tier === 'legendary' || ctx.triggering_quest_tier === 'major') {
    return `${ctx.triggering_quest_title} is inscribed in heavier ink than most. A new threshold opens before you.`;
  }
  return `One deed at a time, the chronicle thickens. ${ctx.triggering_quest_title} carried you across.`;
}

/**
 * Generate a short Archivist commentary for the level-up takeover. Returns
 * a fallback line on timeout / rate-limit / error so the UI never has to
 * branch on failure.
 */
export async function generateLevelUpNarration(ctx: LevelUpContext): Promise<string> {
  try {
    const result = await withTimeout(
      callClaudeProxy<{ narration: string }>('level_up_narration', ctx),
      TIMEOUT_MS,
      'level_up_narration',
    );
    const text = result.data?.narration?.trim();
    return text && text.length > 0 ? text : fallbackNarration(ctx);
  } catch (e) {
    if (e instanceof ClaudeProxyError && e.isRateLimited()) {
      console.warn('level_up_narration rate-limited; using fallback', e.message);
    } else {
      console.warn('level_up_narration failed; using fallback', e);
    }
    return fallbackNarration(ctx);
  }
}
