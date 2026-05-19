-- Phase 4.3 follow-up, remote push for debuff warnings.
--
-- Adds a push_tokens table (one Expo push token per user), a notified_at
-- column on modifiers so each debuff is announced exactly once, and
-- extends the daily cron to dispatch warnings via Expo's push API
-- (https://exp.host/--/api/v2/push/send) using pg_net.
--
-- pg_net is preinstalled on Supabase. The HTTP call is fire-and-forget;
-- if Expo rejects a token (uninstalled app, etc.) the next refresh on
-- the client side will overwrite the row with a fresh token.

create extension if not exists pg_net;

-- One row per user. The latest token wins, we upsert on user_id.
create table if not exists public.push_tokens (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  expo_token text not null,
  updated_at timestamptz not null default now()
);

alter table public.push_tokens enable row level security;

-- RLS, caller manages only their own row. The dispatch path runs under
-- security definer so it can read every user's token without a separate
-- "service" policy.
create policy "Users read own push token"
  on public.push_tokens for select
  using (auth.uid() = user_id);

create policy "Users insert own push token"
  on public.push_tokens for insert
  with check (auth.uid() = user_id);

create policy "Users update own push token"
  on public.push_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users delete own push token"
  on public.push_tokens for delete
  using (auth.uid() = user_id);

-- Track when each debuff was announced so we don't double-notify.
alter table public.modifiers add column if not exists notified_at timestamptz;

-- ---------------------------------------------------------------------------
-- notify_user_of_debuffs(p_user_id), dispatches Expo push for any
-- unconsumed, unnotified debuffs the user has. Marks them notified after
-- the request fires (we don't wait for the response, pg_net is async).
-- ---------------------------------------------------------------------------
create or replace function public.notify_user_of_debuffs(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_count int := 0;
  v_debuff record;
  v_body text;
begin
  select expo_token into v_token from public.push_tokens where user_id = p_user_id;
  if v_token is null then return 0; end if;

  for v_debuff in
    select id, name, effect_description
    from public.modifiers
    where user_id = p_user_id
      and type = 'debuff'
      and consumed_at is null
      and notified_at is null
  loop
    v_body := coalesce(v_debuff.effect_description,
                       'A debuff has settled on you. Tend the Tome before it deepens.');
    -- Fire-and-forget Expo push. The pg_net response_id is unused.
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object(
        'Accept', 'application/json',
        'Content-Type', 'application/json',
        'Accept-encoding', 'gzip, deflate'
      ),
      body := jsonb_build_object(
        'to', v_token,
        'title', v_debuff.name,
        'body', v_body,
        'sound', 'default',
        'priority', 'normal'
      )
    );
    update public.modifiers set notified_at = now() where id = v_debuff.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Replace the existing cron entry point so it both refreshes AND notifies.
-- ---------------------------------------------------------------------------
create or replace function public.cron_refresh_all_debuffs()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count int := 0;
begin
  for r in select id from public.profiles loop
    perform public.refresh_debuffs_for_user(r.id);
    perform public.notify_user_of_debuffs(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
