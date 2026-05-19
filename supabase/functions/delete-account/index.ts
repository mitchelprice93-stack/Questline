// Phase 5.x, account deletion.
//
// Apple's App Store guideline §5.1.1(v) requires apps that allow account
// creation to provide in-app account deletion. This edge function uses the
// service-role key to call auth.admin.deleteUser(), which cascades through
// every FK on profiles (factions, campaigns, quests, modifiers, xp_log,
// subscriptions, ai_call_log, etc., all `on delete cascade`).
//
// To deploy: `npx supabase functions deploy delete-account --project-ref <ref>`
// Required secret: SUPABASE_SERVICE_ROLE_KEY (already set for claude-proxy).

import { createClient } from 'npm:@supabase/supabase-js@2';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return jsonResponse({ error: 'Server misconfigured: missing required env var' }, 500);
  }

  // Verify the caller via their JWT, we only delete the user who owns the
  // session, never an arbitrary user_id from the body.
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401);
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: 'Invalid session' }, 401);
  const userId = userData.user.id;

  // Delete the auth.users row via service role. Every dependent table
  // cascades (FK on delete cascade in initial schema), so a single delete
  // call removes all the user's data, profile, quests, modifiers, xp_log,
  // factions, campaigns, subscriptions, ai_call_log.
  const adminClient = createClient(supabaseUrl, serviceKey);
  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error('[delete-account] failed', deleteError);
    return jsonResponse({ error: deleteError.message }, 500);
  }

  return jsonResponse({ success: true });
});
