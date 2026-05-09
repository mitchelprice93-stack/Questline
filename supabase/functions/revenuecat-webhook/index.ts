// Phase 5.1 — RevenueCat → Supabase webhook.
//
// RevenueCat dispatches every subscription state change to this URL via
// HTTP POST. We verify the shared-secret Authorization header, look up
// our user_id (RC's app_user_id), and upsert the row in
// public.subscriptions accordingly.
//
// Setup in RevenueCat dashboard:
//   1. Create a project, configure the iOS + Android app + products.
//   2. Project Settings → Integrations → Webhooks → Add webhook.
//      URL: https://<project-ref>.supabase.co/functions/v1/revenuecat-webhook
//      Authorization header: Bearer <shared_secret>
//   3. Set the same secret on the Supabase function:
//      `supabase secrets set REVENUECAT_WEBHOOK_SECRET=<shared_secret>`
//
// Webhook event types we care about (full list:
// https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields):
//   - INITIAL_PURCHASE / RENEWAL / PRODUCT_CHANGE — set tier=hero, status=active
//   - CANCELLATION — keep tier=hero until expiry, status=cancelled
//   - EXPIRATION — set tier=free, status=expired
//   - BILLING_ISSUE — keep tier=hero but mark status=expired (grace period)
//
// Deploy: `npx supabase functions deploy revenuecat-webhook --no-verify-jwt`
// (no-verify-jwt because RC is the caller, not an authenticated user.)

import { createClient } from 'npm:@supabase/supabase-js@2';

interface RcWebhookEvent {
  type: string;
  app_user_id: string;
  product_id?: string;
  expiration_at_ms?: number | null;
  entitlement_ids?: string[];
}

interface RcWebhookPayload {
  event: RcWebhookEvent;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  const expectedSecret = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!expectedSecret || !supabaseUrl || !serviceKey) {
    return jsonResponse({ error: 'Server misconfigured: missing required env var' }, 500);
  }

  // Verify the shared-secret bearer header. RC sends it as
  // `Authorization: Bearer <secret>`.
  const authHeader = req.headers.get('Authorization') ?? '';
  const presented = authHeader.replace(/^Bearer\s+/i, '');
  if (presented !== expectedSecret) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  let payload: RcWebhookPayload;
  try {
    payload = (await req.json()) as RcWebhookPayload;
  } catch {
    return jsonResponse({ error: 'Body must be JSON' }, 400);
  }

  const event = payload.event;
  if (!event?.type || !event.app_user_id) {
    return jsonResponse({ error: 'Missing event.type or event.app_user_id' }, 400);
  }

  // Compute the resulting subscriptions row from the event type.
  let tier: 'free' | 'hero' = 'free';
  let status: 'active' | 'trial' | 'expired' | 'cancelled' = 'expired';

  switch (event.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'PRODUCT_CHANGE':
    case 'UNCANCELLATION':
      tier = 'hero';
      status = 'active';
      break;
    case 'CANCELLATION':
      // User cancelled but is still entitled until expiry — keep tier=hero
      // until EXPIRATION fires. UI shows "cancelled, ends <date>".
      tier = 'hero';
      status = 'cancelled';
      break;
    case 'EXPIRATION':
    case 'BILLING_ISSUE':
      tier = 'free';
      status = 'expired';
      break;
    case 'TRANSFER':
      // Sub moved to a different app_user_id — RC sends two events; the
      // user receiving sees INITIAL_PURCHASE, the user losing sees
      // EXPIRATION. We can ignore the TRANSFER event itself.
      return jsonResponse({ ignored: 'TRANSFER' });
    default:
      // Subscription pause, refund, etc. — log and ignore.
      console.log('[rc-webhook] unhandled event type', event.type);
      return jsonResponse({ ignored: event.type });
  }

  const expiresAt = event.expiration_at_ms
    ? new Date(event.expiration_at_ms).toISOString()
    : null;

  // Upsert via service role (bypasses RLS — webhook is trusted).
  const adminClient = createClient(supabaseUrl, serviceKey);
  const { error } = await adminClient
    .from('subscriptions')
    .upsert(
      {
        user_id: event.app_user_id,
        tier,
        status,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    );
  if (error) {
    console.error('[rc-webhook] upsert failed', error);
    return jsonResponse({ error: error.message }, 500);
  }

  return jsonResponse({ ok: true, tier, status, expires_at: expiresAt });
});
