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

// Diagnostic: monkey-patch Headers.append so we can see EXACTLY which header
// key/value pair fails Deno's ByteString check. The SDK fails during request
// construction (before fetch is even called), so this is the only way to
// catch it.
const _OriginalHeaders = globalThis.Headers;
class LoggedHeaders extends _OriginalHeaders {
  append(name: string, value: string): void {
    try {
      super.append(name, value);
    } catch (e) {
      const nonAscii = [...String(value)]
        .map((c, i) => ({ c, i, code: c.charCodeAt(0) }))
        .filter((x) => x.code > 127);
      console.log(
        `[Headers.append] FAILED  name=${JSON.stringify(name)}  value=${JSON.stringify(String(value).slice(0, 200))}  nonAsciiChars=${JSON.stringify(nonAscii.slice(0, 10))}`,
      );
      throw e;
    }
  }
  set(name: string, value: string): void {
    try {
      super.set(name, value);
    } catch (e) {
      const nonAscii = [...String(value)]
        .map((c, i) => ({ c, i, code: c.charCodeAt(0) }))
        .filter((x) => x.code > 127);
      console.log(
        `[Headers.set] FAILED  name=${JSON.stringify(name)}  value=${JSON.stringify(String(value).slice(0, 200))}  nonAsciiChars=${JSON.stringify(nonAscii.slice(0, 10))}`,
      );
      throw e;
    }
  }
}
// deno-lint-ignore no-explicit-any
(globalThis as any).Headers = LoggedHeaders;

// ASCII-only normalization for body content — defensive workaround in case
// non-ASCII bytes are leaking into a header somewhere downstream.
function normalizeAscii(s: string): string {
  return s
    .replace(/[—–]/g, '-') // em-dash, en-dash → hyphen
    .replace(/[‘’]/g, "'") // smart single quotes
    .replace(/[“”]/g, '"') // smart double quotes
    .replace(/…/g, '...') // ellipsis
    .replace(/ /g, ' ') // non-breaking space
    .replace(/[^\x00-\x7F]/g, ''); // anything else outside ASCII: drop
}

function deepNormalize(value: unknown): unknown {
  if (typeof value === 'string') return normalizeAscii(value);
  if (Array.isArray(value)) return value.map(deepNormalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepNormalize(v);
    return out;
  }
  return value;
}

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
  endpoint: 'character_creation' | 'quest_generation';
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
  },
  required: [
    'title',
    'description',
    'objectives',
    'classification',
    'suggested_tier',
    'tactical_warnings',
  ],
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
    case 'quest_generation':
      return {
        content:
          `The chronicler offers a new endeavor. Their words and current context:\n\n${JSON.stringify(req.payload, null, 2)}\n\n` +
          `Forge a quest. Return JSON matching the supplied schema. ` +
          `Tier reflects effort — trivial (a few minutes), minor, standard, major, legendary (multi-day or harder). ` +
          `Classification is daily/side/main/legendary based on cadence. ` +
          `Objectives are an in-order checklist of concrete steps; start with completed=false on every entry. ` +
          `Tactical warnings are short in-voice notes on scope, dependencies, or risk — leave the array empty if there's nothing useful to say.`,
        schema: QUEST_GENERATION_SCHEMA,
      };
  }
}

function pickModel(endpoint: ProxyRequest['endpoint']): keyof typeof PRICING {
  // Both Phase 2.1 endpoints want narrative; route to Sonnet. Future cheap
  // parsing/classification endpoints can route to Haiku.
  switch (endpoint) {
    case 'character_creation':
    case 'quest_generation':
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
  if (!body.endpoint || !['character_creation', 'quest_generation'].includes(body.endpoint)) {
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
  const { content: rawUserMessage, schema } = buildUserMessage(body);
  // Normalize body strings to ASCII-only as a defensive measure against
  // non-ASCII bytes triggering Deno's strict ByteString header check.
  const userMessage = normalizeAscii(rawUserMessage);
  const model = pickModel(body.endpoint);
  const inference = ENDPOINT_INFERENCE[body.endpoint];
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  let inputTokens = 0;
  let outputTokens = 0;
  let parsed: unknown;
  try {
    // Only spread `thinking` when it's set — passing `undefined` to the SDK
    // can still trigger header injection on some versions.
    const request: Record<string, unknown> = {
      model,
      max_tokens: inference.max_tokens,
      system: normalizeAscii(ARCHIVIST_PROMPT),
      messages: [{ role: 'user', content: userMessage }],
      output_config: {
        format: { type: 'json_schema', schema: deepNormalize(schema) },
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
