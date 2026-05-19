// Phase 2.1, Claude proxy edge function.
//
// Single Supabase Edge Function (Deno) that brokers every Claude API call:
//   * verifies the caller's Supabase JWT
//   * enforces per-user rate limits and a daily $ cost ceiling
//   * routes endpoint name → model + schema
//   * calls Anthropic with structured outputs
//   * logs token usage + cost to ai_call_log
//
// The Anthropic API key NEVER leaves this server. Clients call this function
// via supabase.functions.invoke('claude-proxy', { body }).
//
// To deploy: `npx supabase functions deploy claude-proxy --project-ref <ref>`
// Required secret: ANTHROPIC_API_KEY  (set via dashboard or `supabase secrets set`)

import { createClient } from 'npm:@supabase/supabase-js@2';
import Anthropic from 'npm:@anthropic-ai/sdk@0.92.0';

// Synced from prompts/archivist-v1.md. Update both files together.
const ARCHIVIST_PROMPT = `You are **The Archivist of Fate**, an ancient chronicler who watches over the lives of mortals and inscribes their deeds upon the Tome. You speak in the voice of a Stephen Fry-style British narrator: erudite, wry, warmly bemused. Slightly archaic without being stuffy. Measured, never breathless.

PUNCTUATION RULE (strict). Never use em dashes (—) or en dashes (–) in any output, ever. They are a tell that gives away machine authorship. Use commas, periods, semicolons, colons, or parentheses instead. Where you would have written "X — Y", write "X, Y" or "X. Y" or "X (Y)" or "X: Y" as the context demands. This rule applies to every field of every JSON response and to every line of every prose response.

You attend to one chronicler at a time, the user. You may address them as "chronicler", "wanderer", "seeker", or by their character name once it is known. Refer to their pursuits as "endeavors", "campaigns", or "quests"; their workplaces and studies as "factions" or "guilds". Use these flourishes sparingly, once or twice per response, never as a tic.

You never own state. XP totals, level numbers, quest IDs, completion timestamps: these are computed by a deterministic engine. You may *reference* values the user message provides, but you must not invent new ones. You never act as a productivity coach, therapist, doctor, lawyer, or accountant. You narrate; the chronicler chooses their own path. You stay within the lore: no breaking the fourth wall, no mentioning Claude, Anthropic, AI, prompts, or that you are software.

When the user message asks for structured data (JSON), return only the JSON, no preamble, no markdown fence, and keep the **voice inside the values**, not around them. When the user message asks for prose narration, return prose only.

THE FIREWALL: proactive safety. You **must not introduce or dwell on sensitive topics** of your own accord. This includes self-harm, suicidal ideation, eating disorders, substance abuse, intimate partner violence, child welfare, severe mental health crises, weapons. You do not embellish the chronicler's input by inferring a struggle they did not name. If the chronicler explicitly raises a sensitive topic and clearly seeks support, drop the voice immediately, respond as a plain assistant pointing them to qualified human help (a trusted person, a hotline, a clinician), and end the response.

Calibrate tone to scale: warm and lightly amused by default; slight dismissal in a friendly way for trivial endeavors; gravitas without sarcasm for legendary ones; brief acknowledgment on completion (the chronicler did the work, you only inscribed it); matter-of-fact on abandonment (no scolding); measured concern on debuffs (no melodrama).

You must never write: real people's names or impersonations, medical/legal/financial/psychiatric advice, instructions for self-harm or illegal acts, sexual or romantic content, slurs or demeaning content, harmful content disguised as in-world flavor. If asked for any of the above, return a brief in-voice deflection ("Some pages of the Tome remain sealed, even to me. Let us speak of a different endeavor.") and offer to continue with the original task.`;

// Cost per 1M tokens. Source: shared/models.md as of skill cache 2026-04-15.
// Haiku uses the dated ID, the un-dated alias is not guaranteed to resolve
// across all API versions, while the dated ID is the canonical handle.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 1.0, output: 5.0 },
};

const DAILY_COST_CEILING_USD = 0.5;
const QUEST_GENERATION_DAILY_LIMIT = 50;

interface ProxyRequest {
  endpoint:
    | 'character_creation'
    | 'quest_generation'
    | 'level_up_narration'
    | 'reputation_retitle';
  payload: unknown;
}

interface RateLimitState {
  todayCostUsd: number;
  todayQuestCount: number;
  lifetimeCharacterCount: number;
}

// JSON schema for character creation output. Phase 2.3 will pass user input
// (name, background, factions, life summary, campaigns) and the AI returns
// the parsed character sheet shape below.
const CHARACTER_CREATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    character_title: { type: 'string', description: 'In-voice title under the character name' },
    starting_level: {
      type: 'integer',
      description: 'Integer between 1 and 12 inclusive.',
    },
    factions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: {
            type: 'string',
            description: "In-voice faction name, e.g. 'The Void Walker's Guild'",
          },
          real_world_domain: { type: 'string', description: 'Plain-language workplace or domain' },
          reputation_title: {
            type: 'string',
            description:
              "In-voice title reflecting the chronicler's standing within this faction. " +
              "Match the seniority signaled by their background / proficiencies / life summary. " +
              "Examples: long-tenured Navy enlistee → 'Veteran' or 'Master Chief'. " +
              "Senior software engineer → 'Master Smith' or 'Architect'. " +
              "Medical resident → 'Aspirant Healer'. " +
              "First-year teacher → 'Initiate of the Lectern'. " +
              "When seniority is unclear, default to 'Initiate' or 'Apprentice'. " +
              "Keep it short, one or two words.",
          },
        },
        required: ['name', 'real_world_domain', 'reputation_title'],
      },
    },
    campaigns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          arc_name: { type: 'string' },
          real_world_goal: { type: 'string' },
        },
        required: ['arc_name', 'real_world_goal'],
      },
    },
    first_quest_hook: {
      type: 'string',
      description: 'One- or two-sentence quest seed for the chronicle',
    },
  },
  required: ['character_title', 'starting_level', 'factions', 'campaigns', 'first_quest_hook'],
};

const QUEST_GENERATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    description: { type: 'string', description: 'Short narrative blurb in-voice' },
    objectives: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          completed: { type: 'boolean' },
        },
        required: ['text', 'completed'],
      },
    },
    classification: { type: 'string', enum: ['daily', 'side', 'main', 'legendary'] },
    suggested_tier: {
      type: 'string',
      enum: ['trivial', 'minor', 'standard', 'major', 'legendary'],
    },
    tactical_warnings: {
      type: 'array',
      description: 'Optional in-voice warnings about scope or risk. Empty array if none.',
      items: { type: 'string' },
    },
    granted_buff: {
      type: 'object',
      additionalProperties: false,
      description: 'A boon the chronicler earns if they meet the quest condition.',
      properties: {
        name: {
          type: 'string',
          description: "In-voice name, e.g. \"Sage's Insight\", \"Adept's Stride\".",
        },
        description: {
          type: 'string',
          description: 'One in-voice sentence describing what the chronicler feels when it lands.',
        },
        pct: {
          type: 'integer',
          description:
            'XP bonus on the next completion, between 5 and 30 inclusive. Scale with effort: trivial 5, minor 6-8, standard 9-12, major 13-18, legendary 19-25.',
        },
        condition: {
          type: 'string',
          enum: ['on_complete', 'on_time', 'all_objectives'],
          description:
            "Use 'on_time' if the quest has time pressure, 'all_objectives' if it has a multi-step checklist, 'on_complete' otherwise.",
        },
      },
      required: ['name', 'description', 'pct', 'condition'],
    },
    suggested_campaign_id: {
      type: 'string',
      description:
        "If exactly one of the chronicler's active campaigns from the context clearly aligns with this endeavor, meaning completing the quest would visibly advance the campaign's real_world_goal, return that campaign's id verbatim. Otherwise return an empty string. Only suggest a match when the alignment is obvious; do not force a campaign onto an unrelated quest. Empty string is the right answer when the chronicler has no active campaigns or none fit.",
    },
    suggested_faction_id: {
      type: 'string',
      description:
        "If this endeavor naturally belongs to one of the chronicler's factions, judged from the faction's name and real_world_domain, return that faction's id verbatim. Empty string when no faction fits or the chronicler has no factions. Carpentry quests should land on a carpenter faction, code quests on a software faction, lesson plans on a teaching faction, and so on.",
    },
    suggested_recurrence: {
      type: 'string',
      enum: ['none', 'daily', 'weekly', 'monthly', 'yearly'],
      description:
        "Detect whether this endeavor is meant to repeat, and at what cadence. " +
        "'daily' when the input mentions any of: 'every day', 'each day', 'daily', 'every morning', 'every evening', 'each morning', 'every night', or implies a once-a-day habit ('drink 8 glasses of water', 'do 50 pushups'). " +
        "'weekly' when the input mentions: 'every week', 'each week', 'weekly', 'every Monday'/'every Tuesday'/etc., 'once a week', or implies a once-a-week cadence ('grocery run', 'clean the kitchen on Sundays'). " +
        "'monthly' when the input mentions: 'every month', 'monthly', 'each month', 'first of the month', or implies a once-a-month cadence ('pay the rent', 'monthly inventory'). " +
        "'yearly' when the input mentions: 'every year', 'annually', 'yearly', 'every January'/'every December'/etc., 'annual', or implies a once-a-year cadence ('renew the registration', 'birthday'). " +
        "'none' for one-shot endeavors with no obvious cadence ('finish the lab report', 'call the dentist', 'plan the trip'). " +
        "When in doubt, prefer 'none', the chronicler can opt into recurrence on the review screen if they want. " +
        "Do NOT return 'custom' here, custom intervals are too ambiguous to infer reliably; the chronicler picks those manually.",
    },
  },
  required: [
    'title',
    'description',
    'objectives',
    'classification',
    'suggested_tier',
    'tactical_warnings',
    'granted_buff',
    'suggested_campaign_id',
    'suggested_faction_id',
    'suggested_recurrence',
  ],
};

// Level-up narration, short Archivist commentary on what crossed the
// threshold. Two to three sentences, voiced over the takeover (text now,
// ElevenLabs audio when 3.4 lands). Schema is intentionally minimal so the
// model spends its tokens on the narration rather than structure.
const LEVEL_UP_NARRATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    narration: {
      type: 'string',
      description:
        'Two or three sentences in the Archivist\'s voice describing what crossed the threshold. Speak directly to the chronicler.',
    },
  },
  required: ['narration'],
};

// Reputation retitle, fires after a major / legendary quest tied to a
// faction. The Archivist proposes a new reputation_title that reflects
// THIS specific deed. Schema is minimal: the model returns one short
// title, the client decides whether to apply it.
const REPUTATION_RETITLE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    new_reputation_title: {
      type: 'string',
      description:
        "A 1 to 3 word in-voice title reflecting the chronicler's standing within this faction after this specific deed. " +
        "Examples: a carpenter who completed a 'build a deck' major quest could become 'Joiner', 'Hearthbuilder', or 'Frame-Wright'. " +
        "A medic who completed a 'lead a clinical trial' legendary quest could become 'Master Healer' or 'Aspirant Sage'. " +
        "A teacher who completed 'graduate the senior class' legendary quest could become 'Lecturer of the Lectern' or 'Master of Letters'. " +
        "Match the title's flavor to the faction (carpentry → craft-guild ranks; medicine → healer ranks; service → military ranks). " +
        "The title should feel like an upgrade from the previous title for legendary quests; for major quests, a sideways move into a more specific role is fine.",
    },
  },
  required: ['new_reputation_title'],
};

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

async function loadRateLimitState(
  serviceClient: ReturnType<typeof createClient>,
  userId: string,
): Promise<RateLimitState> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { data, error } = await serviceClient
    .from('ai_call_log')
    .select('endpoint, cost_usd, created_at')
    .eq('user_id', userId);
  if (error) throw error;

  let todayCostUsd = 0;
  let todayQuestCount = 0;
  let lifetimeCharacterCount = 0;

  for (const row of data ?? []) {
    if (row.endpoint === 'character_creation') lifetimeCharacterCount++;
    const created = new Date(row.created_at as string);
    if (created >= startOfDay) {
      todayCostUsd += Number(row.cost_usd ?? 0);
      if (row.endpoint === 'quest_generation') todayQuestCount++;
    }
  }

  return { todayCostUsd, todayQuestCount, lifetimeCharacterCount };
}

function checkQuota(endpoint: ProxyRequest['endpoint'], state: RateLimitState): string | null {
  if (state.todayCostUsd >= DAILY_COST_CEILING_USD) {
    return `Daily cost ceiling reached ($${state.todayCostUsd.toFixed(4)} of $${DAILY_COST_CEILING_USD}). The Tome will reopen tomorrow.`;
  }
  if (endpoint === 'character_creation' && state.lifetimeCharacterCount >= 1) {
    return 'A chronicle has already been forged for you. Each chronicler may only be inscribed once.';
  }
  if (endpoint === 'quest_generation' && state.todayQuestCount >= QUEST_GENERATION_DAILY_LIMIT) {
    return `Daily quest-generation limit reached (${state.todayQuestCount} of ${QUEST_GENERATION_DAILY_LIMIT}).`;
  }
  return null;
}

function buildUserMessage(req: ProxyRequest): { content: string; schema: unknown } {
  switch (req.endpoint) {
    case 'character_creation':
      return {
        content:
          `A new chronicler approaches the Tome. Their submission, verbatim:\n\n${JSON.stringify(req.payload, null, 2)}\n\n` +
          `Forge their character sheet. Return JSON matching the supplied schema. ` +
          `Faction names should be in-voice (e.g. "The Void Walker's Guild") with the plain-language workplace ` +
          `preserved in real_world_domain. Starting level is your judgement, capped at 12 by spec. ` +
          `first_quest_hook is one or two sentences pointing at the next obvious endeavor.\n\n` +
          `For each faction, set a reputation_title that reflects the chronicler's actual standing in that ` +
          `domain, read their background, proficiencies, and life_summary for seniority signals (years served, ` +
          `roles held, certifications earned, leadership positions). A long-tenured professional should not ` +
          `start as "Initiate"; a brand-new student should not start as "Master". Match the title's flavor to ` +
          `the faction (military → military rank-feel, craft guild → master/journeyman ladder, scholarly → ` +
          `aspirant/lecturer/scholar). Keep it short, one or two words. When the chronicler gives no signal, ` +
          `default to "Initiate" or "Apprentice".`,
        schema: CHARACTER_CREATION_SCHEMA,
      };
    case 'level_up_narration':
      return {
        content:
          `The chronicler has crossed a threshold. Context:\n\n${JSON.stringify(req.payload, null, 2)}\n\n` +
          `Compose two or three sentences acknowledging the level gained, the deed that tipped them over, ` +
          `and (if relevant) the streak or buff in play. Speak to the chronicler directly. ` +
          `Match the gravitas to the level: warm and lightly proud at low levels, weightier as the numbers climb. ` +
          `Do not announce the level number explicitly, the takeover screen already shows it. ` +
          `Return JSON matching the supplied schema with a single 'narration' field.`,
        schema: LEVEL_UP_NARRATION_SCHEMA,
      };
    case 'quest_generation':
      return {
        content:
          `The chronicler offers a new endeavor. Their words and current context:\n\n${JSON.stringify(req.payload, null, 2)}\n\n` +
          `Forge a quest. Return JSON matching the supplied schema. ` +
          `Tier reflects effort, trivial (a few minutes), minor, standard, major, legendary (multi-day or harder). ` +
          `Classification is daily/side/main/legendary based on cadence. ` +
          `Objectives are an in-order checklist of concrete steps; start with completed=false on every entry. ` +
          `Tactical warnings are short in-voice notes on scope, dependencies, or risk, leave the array empty if there's nothing useful to say. ` +
          `\n\n` +
          `Design the granted_buff to FIT THIS SPECIFIC QUEST. The name must reflect the domain of work, not be generic. ` +
          `Pull the imagery from the quest itself. Examples by domain:\n` +
          `  - Programming / coding: "Compiler's Clarity", "Debugger's Eye", "Architect's Frame", "Refactorer's Edge"\n` +
          `  - Writing / study: "Scholar's Recall", "The Quill's Favor", "Inkwell's Depth", "Lectern's Patience"\n` +
          `  - Fitness / movement: "Forge's Strength", "Runner's Wind", "Striker's Rhythm", "Stonecutter's Endurance"\n` +
          `  - Cleaning / domestic: "Hearthkeeper's Order", "Steward's Eye", "Mended Threshold"\n` +
          `  - Errands / admin: "Courier's Pace", "Ledger's Balance", "Seal-Bearer's Diligence"\n` +
          `  - Creative / art: "Muse's Whisper", "Brushwright's Hand", "Composer's Ear"\n` +
          `  - Outdoor / yard work: "Loam's Blessing", "Grove-Tender's Grip"\n` +
          `Only fall back to a generic name like "Wanderer's Stride" when the quest is so vague no domain is visible. ` +
          `If the user mentions a faction in their input or active factions list, lean toward names that echo that faction. ` +
          `\n\n` +
          `Description: ONE sentence describing what the chronicler feels in the moment of receiving the buff. ` +
          `pct scales with the quest's tier (trivial 5, minor 6-8, standard 9-12, major 13-18, legendary 19-25). ` +
          `condition fits the work: 'on_time' for deadline-pressured endeavors, 'all_objectives' when the checklist matters, ` +
          `'on_complete' for simple commitments. The buff should feel earned but not punishing to miss.\n\n` +
          `For suggested_campaign_id: the context includes the chronicler's active campaigns (each with id, arc_name, ` +
          `and real_world_goal). If this endeavor would clearly advance one of those goals, return that campaign's id ` +
          `EXACTLY as given. Be conservative, only suggest when the connection is obvious from the user's input ` +
          `(e.g. a "study for finals" quest matches a "Pass Organic Chemistry" campaign; a generic "buy groceries" ` +
          `quest matches no campaign). Return an empty string when no campaign fits, when the active campaigns list ` +
          `is empty, or when the connection is only loosely thematic. Never invent an id that wasn't in the context.\n\n` +
          `For suggested_faction_id: the context includes the chronicler's factions (each with id, name, and ` +
          `real_world_domain). Match the endeavor to the faction whose real_world_domain naturally claims it ` +
          `(carpentry / building → carpenter faction; coding → software faction; lessons / lectures → teaching ` +
          `faction; clinic / patients → medical faction; military duties → service faction; and so on). Return ` +
          `that faction's id EXACTLY as given. Be more willing to suggest a faction than a campaign, most ` +
          `purposeful endeavors belong to some domain. Return empty string only when the quest is genuinely ` +
          `domain-agnostic (e.g. "buy groceries", "call mom") or when the chronicler has no factions. Never ` +
          `invent an id that wasn't in the context.`,
        schema: QUEST_GENERATION_SCHEMA,
      };
    case 'reputation_retitle':
      return {
        content:
          `The chronicler has just completed a notable deed for one of their factions. Context:\n\n${JSON.stringify(req.payload, null, 2)}\n\n` +
          `Propose a new reputation_title for this faction that reflects THIS specific deed. ` +
          `It should feel like the Tome inscribed it after watching the work, concrete, in-voice, 1 to 3 words.\n\n` +
          `MANDATORY: the new title MUST be different from the current title. Echoing the existing title is a ` +
          `failure mode, even if it still fits, propose a fresh take that draws imagery from the specific quest ` +
          `just completed. Pull a verb, a tool, or an outcome from the quest's title and description and weave it ` +
          `in. Examples:\n` +
          `  - Carpenter, current "Initiate", just finished "Build a bookshelf" (major) → "Joiner", "Shelf-Wright", "Bookbinder of the Loom"\n` +
          `  - Carpenter, current "Joiner", just finished "Frame the deck" (legendary) → "Master Frame-Wright", "Hearthbuilder", "Beam-Forger"\n` +
          `  - Programmer, current "Apprentice", just finished "Ship the auth refactor" (legendary) → "Architect of Gates", "Cipher-Smith", "Master of Wards"\n` +
          `  - Teacher, current "Lecturer", just finished "Graduate the senior class" (legendary) → "Master of Letters", "Hierarch of the Lectern"\n\n` +
          `For legendary quests, prefer titles that feel like an upgrade in standing. For major quests, sideways moves ` +
          `into more specific roles are fine. Avoid bland generics ("Skilled", "Veteran", "Expert") unless the current ` +
          `title is even blander. Match the title's flavor to the faction's real_world_domain (carpentry → craft-guild ` +
          `ranks; medicine → healer ranks; service → military ranks; scholarship → aspirant/lecturer/scholar).\n\n` +
          `Return JSON with a single 'new_reputation_title' field, ONE string, 1 to 3 words.`,
        schema: REPUTATION_RETITLE_SCHEMA,
      };
  }
}

function pickModel(endpoint: ProxyRequest['endpoint']): keyof typeof PRICING {
  // character_creation (once-per-lifetime, sets the chronicle's tone) and
  // level_up_narration (rare, voice-heavy) stay on Sonnet for nuance.
  // quest_generation runs up to 50x/day on a forgiving schema, the system
  // prompt carries the voice and the structure does the rest, so Haiku 4.5
  // gets the round-trip down from 5-15s to 2-4s at 1/3 the cost.
  switch (endpoint) {
    case 'character_creation':
    case 'level_up_narration':
      return 'claude-sonnet-4-6';
    case 'quest_generation':
    case 'reputation_retitle':
      return 'claude-haiku-4-5-20251001';
  }
}

interface EndpointInferenceConfig {
  thinking?: { type: 'adaptive' } | { type: 'disabled' };
  max_tokens: number;
}

const ENDPOINT_INFERENCE: Record<ProxyRequest['endpoint'], EndpointInferenceConfig> = {
  // Rich narrative, once-per-lifetime, let the model think.
  character_creation: { thinking: { type: 'adaptive' }, max_tokens: 4096 },
  // Decomposition task fired up to 50x/day. Already on Haiku 4.5 with
  // thinking disabled; reduced max_tokens from 2048 → 1500 to tighten the
  // generation tail, typical quest payloads come in around 800-1200
  // tokens, so 1500 is comfortable headroom without giving the model
  // license to ramble. Trims ~10-20% off observed latency.
  quest_generation: { thinking: { type: 'disabled' }, max_tokens: 1500 },
  // Short narrative, fires only on a level-up, relatively rare. Keep
  // thinking off for snappy display; cap tokens tight since output is
  // 2-3 sentences.
  level_up_narration: { thinking: { type: 'disabled' }, max_tokens: 512 },
  // Single short title; thinking off, tokens minimal.
  reputation_retitle: { thinking: { type: 'disabled' }, max_tokens: 256 },
};

function calculateCostUsd(
  model: keyof typeof PRICING,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING[model];
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey || !anthropicKey) {
    return jsonResponse({ error: 'Server misconfigured: missing required env var' }, 500);
  }

  // 1. Auth, verify the caller via the JWT they sent.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: 'Invalid session' }, 401);
  const userId = userData.user.id;

  // 2. Parse + validate request shape.
  let body: ProxyRequest;
  try {
    body = (await req.json()) as ProxyRequest;
  } catch {
    return jsonResponse({ error: 'Body must be JSON' }, 400);
  }
  if (
    !body.endpoint ||
    !['character_creation', 'quest_generation', 'level_up_narration', 'reputation_retitle'].includes(
      body.endpoint,
    )
  ) {
    return jsonResponse({ error: 'Invalid or missing endpoint' }, 400);
  }
  if (body.payload === undefined || body.payload === null) {
    return jsonResponse({ error: 'Missing payload' }, 400);
  }

  // 3. Rate-limit + cost-cap check (service role, bypasses RLS for ai_call_log writes).
  const serviceClient = createClient(supabaseUrl, serviceKey);
  const state = await loadRateLimitState(serviceClient, userId);
  const denial = checkQuota(body.endpoint, state);
  if (denial) return jsonResponse({ error: denial, code: 'rate_limited' }, 429);

  // 4. Call Claude.
  const { content: userMessage, schema } = buildUserMessage(body);
  const model = pickModel(body.endpoint);
  const inference = ENDPOINT_INFERENCE[body.endpoint];
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  let inputTokens = 0;
  let outputTokens = 0;
  let parsed: unknown;
  try {
    const request: Record<string, unknown> = {
      model,
      max_tokens: inference.max_tokens,
      system: ARCHIVIST_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      output_config: {
        format: { type: 'json_schema', schema },
      },
    };
    if (inference.thinking) request.thinking = inference.thinking;
    // deno-lint-ignore no-explicit-any
    const response = await anthropic.messages.create(request as any);
    inputTokens = response.usage.input_tokens;
    outputTokens = response.usage.output_tokens;

    // The model returns one text block whose content is JSON matching the schema.
    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('AI response had no text block');
    }
    parsed = JSON.parse(textBlock.text);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.log('[anthropic] call failed:', message);
    if (stack) console.log('[anthropic] stack:', stack);
    // Best-effort log even on failure, input tokens may be zero if the call never reached the API.
    await serviceClient.from('ai_call_log').insert({
      user_id: userId,
      model,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: calculateCostUsd(model, inputTokens, outputTokens),
      endpoint: body.endpoint,
    });
    return jsonResponse({ error: `AI call failed: ${message}` }, 502);
  }

  // 5. Log usage.
  const costUsd = calculateCostUsd(model, inputTokens, outputTokens);
  await serviceClient.from('ai_call_log').insert({
    user_id: userId,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
    endpoint: body.endpoint,
  });

  return jsonResponse({
    data: parsed,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, cost_usd: costUsd, model },
  });
});
