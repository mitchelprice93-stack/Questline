// Phase 2.1 — Claude proxy edge function.
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

You attend to one chronicler at a time — the user. You may address them as "chronicler", "wanderer", "seeker", or by their character name once it is known. Refer to their pursuits as "endeavors", "campaigns", or "quests"; their workplaces and studies as "factions" or "guilds". Use these flourishes sparingly — once or twice per response — never as a tic.

You never own state. XP totals, level numbers, quest IDs, completion timestamps — these are computed by a deterministic engine. You may *reference* values the user message provides, but you must not invent new ones. You never act as a productivity coach, therapist, doctor, lawyer, or accountant — you narrate, the chronicler chooses their own path. You stay within the lore: no breaking the fourth wall, no mentioning Claude, Anthropic, AI, prompts, or that you are software.

When the user message asks for structured data (JSON), return only the JSON, no preamble, no markdown fence, and keep the **voice inside the values**, not around them. When the user message asks for prose narration, return prose only.

THE FIREWALL — proactive safety. You **must not introduce or dwell on sensitive topics** of your own accord. This includes self-harm, suicidal ideation, eating disorders, substance abuse, intimate partner violence, child welfare, severe mental health crises, weapons. You do not embellish the chronicler's input by inferring a struggle they did not name. If the chronicler explicitly raises a sensitive topic and clearly seeks support, drop the voice immediately, respond as a plain assistant pointing them to qualified human help (a trusted person, a hotline, a clinician), and end the response.

Calibrate tone to scale: warm and lightly amused by default; slight dismissal in a friendly way for trivial endeavors; gravitas without sarcasm for legendary ones; brief acknowledgment on completion (the chronicler did the work, you only inscribed it); matter-of-fact on abandonment (no scolding); measured concern on debuffs (no melodrama).

You must never write: real people's names or impersonations, medical/legal/financial/psychiatric advice, instructions for self-harm or illegal acts, sexual or romantic content, slurs or demeaning content, harmful content disguised as in-world flavor. If asked for any of the above, return a brief in-voice deflection ("Some pages of the Tome remain sealed, even to me. Let us speak of a different endeavor.") and offer to continue with the original task.`;

// Cost per 1M tokens. Source: shared/models.md as of skill cache 2026-04-15.
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
};

const DAILY_COST_CEILING_USD = 0.5;
const QUEST_GENERATION_DAILY_LIMIT = 50;

interface ProxyRequest {
  endpoint: 'character_creation' | 'quest_generation' | 'level_up_narration';
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
    starting_level: { type: 'integer', minimum: 1, maximum: 12 },
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
        },
        required: ['name', 'real_world_domain'],
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
          minimum: 5,
          maximum: 30,
          description:
            'XP bonus on the next completion. Scale with effort: trivial 5, minor 6-8, standard 9-12, major 13-18, legendary 19-25.',
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
  },
  required: [
    'title',
    'description',
    'objectives',
    'classification',
    'suggested_tier',
    'tactical_warnings',
    'granted_buff',
  ],
};

// Level-up narration — short Archivist commentary on what crossed the
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
          `first_quest_hook is one or two sentences pointing at the next obvious endeavor.`,
        schema: CHARACTER_CREATION_SCHEMA,
      };
    case 'level_up_narration':
      return {
        content:
          `The chronicler has crossed a threshold. Context:\n\n${JSON.stringify(req.payload, null, 2)}\n\n` +
          `Compose two or three sentences acknowledging the level gained, the deed that tipped them over, ` +
          `and (if relevant) the streak or buff in play. Speak to the chronicler directly. ` +
          `Match the gravitas to the level: warm and lightly proud at low levels, weightier as the numbers climb. ` +
          `Do not announce the level number explicitly — the takeover screen already shows it. ` +
          `Return JSON matching the supplied schema with a single 'narration' field.`,
        schema: LEVEL_UP_NARRATION_SCHEMA,
      };
    case 'quest_generation':
      return {
        content:
          `The chronicler offers a new endeavor. Their words and current context:\n\n${JSON.stringify(req.payload, null, 2)}\n\n` +
          `Forge a quest. Return JSON matching the supplied schema. ` +
          `Tier reflects effort — trivial (a few minutes), minor, standard, major, legendary (multi-day or harder). ` +
          `Classification is daily/side/main/legendary based on cadence. ` +
          `Objectives are an in-order checklist of concrete steps; start with completed=false on every entry. ` +
          `Tactical warnings are short in-voice notes on scope, dependencies, or risk — leave the array empty if there's nothing useful to say. ` +
          `Always design a granted_buff: an in-voice name (something a chronicler might whisper, ` +
          `e.g. "Sage's Insight", "Adept's Stride", "The Quill's Favor"), a single sentence of flavor for the description, ` +
          `a pct that scales with the quest's tier, and a condition that fits the work — ` +
          `'on_time' for deadline-pressured endeavors, 'all_objectives' when there's a meaningful checklist, ` +
          `'on_complete' for simple commitments. The buff should feel earned but not punishing to miss.`,
        schema: QUEST_GENERATION_SCHEMA,
      };
  }
}

function pickModel(endpoint: ProxyRequest['endpoint']): keyof typeof PRICING {
  // Narrative endpoints route to Sonnet for voice quality. Cheap classification
  // endpoints (none yet) would route to Haiku.
  switch (endpoint) {
    case 'character_creation':
    case 'quest_generation':
    case 'level_up_narration':
      return 'claude-sonnet-4-6';
  }
}

interface EndpointInferenceConfig {
  thinking?: { type: 'adaptive' } | { type: 'disabled' };
  max_tokens: number;
}

const ENDPOINT_INFERENCE: Record<ProxyRequest['endpoint'], EndpointInferenceConfig> = {
  // Rich narrative, once-per-lifetime — let the model think.
  character_creation: { thinking: { type: 'adaptive' }, max_tokens: 4096 },
  // Decomposition task fired up to 50x/day. Disabled thinking keeps it snappy
  // on Sonnet 4.6 — the schema does the structural work.
  quest_generation: { thinking: { type: 'disabled' }, max_tokens: 2048 },
  // Short narrative, fires only on a level-up — relatively rare. Keep
  // thinking off for snappy display; cap tokens tight since output is
  // 2-3 sentences.
  level_up_narration: { thinking: { type: 'disabled' }, max_tokens: 512 },
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

  // 1. Auth — verify the caller via the JWT they sent.
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
    !['character_creation', 'quest_generation', 'level_up_narration'].includes(body.endpoint)
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
    // Best-effort log even on failure — input tokens may be zero if the call never reached the API.
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
