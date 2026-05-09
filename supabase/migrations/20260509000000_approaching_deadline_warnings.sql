-- Phase 4 follow-up — proactive push warnings for approaching deadlines.
--
-- The existing notify_user_of_debuffs only fires after a deadline has
-- already passed and a debuff has landed. That's reactive. This migration
-- adds the proactive piece: any active quest whose deadline falls within
-- the next 24 hours gets a single push warning before the penalty hits.
--
-- Tracking: a deadline_warning_sent_at column on quests records when the
-- warning fired for the CURRENT deadline. A trigger resets it whenever
-- the deadline column changes, so re-scheduling a quest re-arms the
-- warning.

alter table public.quests
  add column if not exists deadline_warning_sent_at timestamptz;

-- ---------------------------------------------------------------------------
-- Reset deadline_warning_sent_at when the deadline changes so a re-scheduled
-- quest gets a fresh approaching-deadline warning. NEW.* applied in BEFORE
-- UPDATE so no extra DML round-trip.
-- ---------------------------------------------------------------------------
create or replace function public.reset_deadline_warning()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if NEW.deadline is distinct from OLD.deadline then
    NEW.deadline_warning_sent_at := null;
  end if;
  return NEW;
end;
$$;

drop trigger if exists reset_deadline_warning_trigger on public.quests;
create trigger reset_deadline_warning_trigger
  before update on public.quests
  for each row
  execute function public.reset_deadline_warning();

-- ---------------------------------------------------------------------------
-- notify_approaching_deadlines(p_user_id) — push a warning for any active
-- quest the user has whose deadline lands in the next 24 hours and which
-- hasn't already been warned about for this deadline. Mirrors the
-- notify_user_of_debuffs shape: read the user's expo_token, fan out one
-- pg_net.http_post per quest, mark the row notified.
-- ---------------------------------------------------------------------------
create or replace function public.notify_approaching_deadlines(p_user_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_quest record;
  v_count int := 0;
  v_hours_left int;
  v_body text;
begin
  select expo_token into v_token from public.push_tokens where user_id = p_user_id;
  if v_token is null then return 0; end if;

  for v_quest in
    select id, title, deadline
    from public.quests
    where user_id = p_user_id
      and status = 'active'
      and deadline is not null
      and deadline > now()
      and deadline <= now() + interval '24 hours'
      and deadline_warning_sent_at is null
  loop
    v_hours_left := greatest(1, ceil(extract(epoch from (v_quest.deadline - now())) / 3600)::int);
    v_body := format(
      '"%s" comes due in roughly %s hour%s. The Tome marks it on its watch.',
      v_quest.title,
      v_hours_left,
      case when v_hours_left = 1 then '' else 's' end
    );

    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := jsonb_build_object(
        'Accept', 'application/json',
        'Content-Type', 'application/json',
        'Accept-encoding', 'gzip, deflate'
      ),
      body := jsonb_build_object(
        'to', v_token,
        'title', 'A deadline draws near',
        'body', v_body,
        'sound', 'default',
        'priority', 'normal'
      )
    );
    update public.quests
      set deadline_warning_sent_at = now()
      where id = v_quest.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Replace the cron entry point to call all three: refresh, debuff dispatch,
-- AND the new approaching-deadline dispatch.
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
    perform public.notify_approaching_deadlines(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
