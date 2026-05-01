// Phase 2.1 — client-side wrapper for the claude-proxy edge function.
//
// All AI calls go through this single helper. It posts to the deployed
// Supabase edge function with the user's JWT (auto-attached by
// supabase.functions.invoke), and returns the parsed structured payload.
//
// Phase 2.3 / 2.4 will wrap this with typed helpers per endpoint.

import { supabase } from './supabase';

export interface ClaudeProxyUsage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  model: string;
}

export interface ClaudeProxyResult<T> {
  data: T;
  usage: ClaudeProxyUsage;
}

export type ClaudeProxyEndpoint = 'character_creation' | 'quest_generation';

export class ClaudeProxyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ClaudeProxyError';
  }

  /** True when the server denied us due to rate limit or cost cap. */
  isRateLimited(): boolean {
    return this.status === 429 || this.code === 'rate_limited';
  }
}

export async function callClaudeProxy<T>(
  endpoint: ClaudeProxyEndpoint,
  payload: unknown,
): Promise<ClaudeProxyResult<T>> {
  const { data, error } = await supabase.functions.invoke<{
    data?: T;
    usage?: ClaudeProxyUsage;
    error?: string;
    code?: string;
  }>('claude-proxy', { body: { endpoint, payload } });

  if (error) {
    // FunctionsHttpError, FunctionsRelayError, FunctionsFetchError — surface the
    // status if available so callers can branch on rate-limit vs server failure.
    const status = (error as { context?: { status?: number } }).context?.status ?? 500;
    throw new ClaudeProxyError(error.message, status);
  }
  if (!data) {
    throw new ClaudeProxyError('Empty response from claude-proxy', 502);
  }
  if (data.error) {
    throw new ClaudeProxyError(data.error, 400, data.code);
  }
  if (!data.data || !data.usage) {
    throw new ClaudeProxyError('Malformed response from claude-proxy', 502);
  }
  return { data: data.data, usage: data.usage };
}
