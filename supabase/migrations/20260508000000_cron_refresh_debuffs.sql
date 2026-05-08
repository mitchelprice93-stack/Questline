-- Phase 4.2 follow-up — schedule debuff refresh as a daily cron job.
--
-- Until now refresh_debuffs_for ran lazily on Character Sheet load,
-- which means a user who never opened the app never accrued debuffs —
-- defeating the purpose of the system. Daily pg_cron walks every
-- profile and reconciles each user's debuffs against their quest state.
--
-- pg_cron is available on Supabase (free tier and up). The user-facing
-- refresh_debuffs_for stays as-is with its auth.uid() guard; we add a
-- security-definer twin for cron use.

create extension if not exists pg_cron;

-- Internal version of refresh_debuffs_for that bypasses the auth check.
-- Called by cron and by the user-facing wrapper. SECURITY DEFINER so it
-- runs with the function owner's privileges (postgres role) instead of
-- the caller's — that's what makes it safe to invoke from cron.
create or replace function public.refresh_debuffs_for_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quest record;
  v_overdue_days numeric;
begin
  -- Expire any buffs whose lifetime has run out.
  update public.modifiers
    set consumed_at = now()
    where user_id = p_user_id
      and type = 'buff'
      and consumed_at is null
      and expires_at is not null
      and expires_at <= now();

  -- Walk active quests with a deadline that's already in the past. Quests
  -- without a deadline are skipped (long-running campaigns are fine).
  for v_quest in
    select id, deadline
    from public.quests
    where user_id = p_user_id
      and status = 'active'
      and deadline is not null
      and deadline < now()
  loop
    v_overdue_days := extract(epoch from (now() - v_quest.deadline)) / 86400;

    if v_overdue_days >= 7 then
      insert into public.modifiers (
        user_id, type, name, effect_description, xp_modifier_pct, source_kind, quest_id
      )
      select p_user_id, 'debuff', 'Curse of the Idle Blade',
             'XP halved on the next completion — the deadline has long since passed.',
             -50, 'deadline_long_overdue', v_quest.id
      where not exists (
        select 1 from public.modifiers
        where user_id = p_user_id and quest_id = v_quest.id
          and source_kind = 'deadline_long_overdue' and consumed_at is null
      );
    elsif v_overdue_days >= 1 then
      insert into public.modifiers (
        user_id, type, name, effect_description, xp_modifier_pct, source_kind, quest_id
      )
      select p_user_id, 'debuff', 'Cobwebs of Procrastination',
             '−10% XP on the next completion — the hour has passed.',
             -10, 'deadline_missed', v_quest.id
      where not exists (
        select 1 from public.modifiers
        where user_id = p_user_id and quest_id = v_quest.id
          and source_kind = 'deadline_missed' and consumed_at is null
      );
    end if;
  end loop;
end;
$$;

-- Re-point the user-facing function at the internal one. The auth check
-- stays here so the API remains gated to the calling user.
create or replace function public.refresh_debuffs_for(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() <> p_user_id then
    raise exception 'Cannot refresh debuffs for another user' using errcode = '42501';
  end if;
  perform public.refresh_debuffs_for_user(p_user_id);
end;
$$;

-- Cron entry point. Walks every profile and refreshes its debuffs.
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
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Schedule for 06:00 UTC daily. Idempotent: unschedule first if it
-- already exists so re-running this migration doesn't duplicate the job.
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'refresh-debuffs-daily';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end $$;

select cron.schedule(
  'refresh-debuffs-daily',
  '0 6 * * *',
  $$select public.cron_refresh_all_debuffs()$$
);
