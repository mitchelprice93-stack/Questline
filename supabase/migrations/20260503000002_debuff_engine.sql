-- Phase 4.2: debuff engine.
--
-- The modifiers table already exists from the initial schema; we extend it
-- with the bookkeeping needed to source debuffs from quest state and consume
-- them at the next completion.

alter table public.modifiers
  add column if not exists quest_id uuid references public.quests (id) on delete cascade,
  add column if not exists consumed_at timestamptz,
  add column if not exists source_kind text;

-- Add a check on source_kind without dropping any existing data. Skip if the
-- constraint already exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'modifiers_source_kind_check'
  ) then
    alter table public.modifiers
      add constraint modifiers_source_kind_check
      check (source_kind is null or source_kind in (
        'untouched_3d', 'untouched_7d', 'abandoned', 'manual_buff'
      ));
  end if;
end $$;

create index if not exists modifiers_user_active_idx
  on public.modifiers (user_id) where consumed_at is null;
create index if not exists modifiers_quest_idx
  on public.modifiers (quest_id) where consumed_at is null;

-- Track the last time the user invoked +rest so we can enforce the once-a-week
-- cooldown without a separate table.
alter table public.profiles add column if not exists last_rest_at timestamptz;

-- ---------------------------------------------------------------------------
-- refresh_debuffs_for(p_user_id)
--
-- Reconciles time-based debuffs against the user's current quest state.
-- Idempotent: skips inserts when an unconsumed debuff for the same
-- (quest_id, source_kind) already exists. Should be called on every screen
-- load that displays modifiers, and (eventually) by a daily pg_cron job.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_debuffs_for(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_quest record;
  v_age_days numeric;
begin
  if auth.uid() <> p_user_id then
    raise exception 'Cannot refresh debuffs for another user' using errcode = '42501';
  end if;

  -- Untouched-quest debuffs: walk active quests, derive last-touch as
  -- last_completed_at (recurring) or created_at (one-shot, until we add an
  -- updated_at column). Insert the appropriate debuff if the threshold's been
  -- crossed and an unconsumed one for the same source isn't already on file.
  for v_quest in
    select id, last_completed_at, created_at
    from public.quests
    where user_id = p_user_id and status = 'active'
  loop
    v_age_days := extract(epoch from (
      now() - coalesce(v_quest.last_completed_at, v_quest.created_at)
    )) / 86400;

    if v_age_days >= 7 then
      insert into public.modifiers (
        user_id, type, name, effect_description, xp_modifier_pct, source_kind, quest_id
      )
      select p_user_id, 'debuff', 'Curse of the Idle Blade',
             'XP halved on the next completion',
             -50, 'untouched_7d', v_quest.id
      where not exists (
        select 1 from public.modifiers
        where user_id = p_user_id
          and quest_id = v_quest.id
          and source_kind = 'untouched_7d'
          and consumed_at is null
      );
    elsif v_age_days >= 3 then
      insert into public.modifiers (
        user_id, type, name, effect_description, xp_modifier_pct, source_kind, quest_id
      )
      select p_user_id, 'debuff', 'Cobwebs of Procrastination',
             '−10% XP on the next completion',
             -10, 'untouched_3d', v_quest.id
      where not exists (
        select 1 from public.modifiers
        where user_id = p_user_id
          and quest_id = v_quest.id
          and source_kind = 'untouched_3d'
          and consumed_at is null
      );
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- abandon_quest, extended to apply Mark of the Forsaken
-- ---------------------------------------------------------------------------
create or replace function public.abandon_quest(quest_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  update public.quests
    set status = 'abandoned', abandoned_at = now()
    where id = quest_id and status = 'active'
    returning user_id into v_user_id;

  if v_user_id is null then
    raise exception 'Quest not found or not active' using errcode = 'P0002';
  end if;

  insert into public.modifiers (
    user_id, type, name, effect_description, xp_modifier_pct, source_kind, quest_id
  )
  values (
    v_user_id, 'debuff', 'Mark of the Forsaken',
    '−5% XP on the next completion',
    -5, 'abandoned', quest_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- complete_quest, extended to apply unconsumed debuffs to the base reward
-- and consume them. Difficulty rules:
--   apprentice / adept    → only the worst (most negative) debuff applies
--   master / legendary    → all unconsumed debuffs stack (sum of pcts)
-- ---------------------------------------------------------------------------
drop function if exists public.complete_quest(uuid);

create function public.complete_quest(quest_id uuid)
returns table (
  new_total_xp bigint,
  xp_change int,
  new_streak int,
  milestone_bonus int,
  debuff_pct int
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_xp_reward int;
  v_recurrence text;
  v_last_completed timestamptz;
  v_current_streak int;
  v_new_streak int := 0;
  v_milestone_bonus int := 0;
  v_difficulty text;
  v_debuff_pct int := 0;
  v_base_after_debuff int;
  v_total_xp int;
  v_new_total bigint;
begin
  select user_id, xp_reward, recurrence, last_completed_at, streak_count
    into v_user_id, v_xp_reward, v_recurrence, v_last_completed, v_current_streak
    from public.quests
    where id = quest_id and status = 'active'
    for update;

  if v_user_id is null then
    raise exception 'Quest not found or not active' using errcode = 'P0002';
  end if;

  select difficulty into v_difficulty from public.profiles where id = v_user_id;

  -- Compute the debuff modifier per difficulty rules.
  if v_difficulty in ('master', 'legendary') then
    select coalesce(sum(xp_modifier_pct), 0) into v_debuff_pct
      from public.modifiers
      where user_id = v_user_id
        and type = 'debuff'
        and consumed_at is null;
  else
    select coalesce(min(xp_modifier_pct), 0) into v_debuff_pct
      from public.modifiers
      where user_id = v_user_id
        and type = 'debuff'
        and consumed_at is null;
  end if;

  -- Floor the modifier at -100% so a single completion can never go negative.
  if v_debuff_pct < -100 then
    v_debuff_pct := -100;
  end if;

  v_base_after_debuff := greatest(0, round(v_xp_reward * (1 + v_debuff_pct::numeric / 100)));

  -- Recurring vs one-shot streak math (same as before).
  if v_recurrence is null then
    update public.quests
      set status = 'completed', completed_at = now()
      where id = quest_id;
  else
    if v_last_completed is not null then
      if v_recurrence = 'daily'
         and date_trunc('day', v_last_completed) = date_trunc('day', now()) then
        raise exception 'Quest already completed for today' using errcode = 'P0003';
      end if;
      if v_recurrence = 'weekly'
         and date_trunc('week', v_last_completed) = date_trunc('week', now()) then
        raise exception 'Quest already completed for this week' using errcode = 'P0003';
      end if;
    end if;

    if v_last_completed is null then
      v_new_streak := 1;
    elsif v_recurrence = 'daily' then
      if date_trunc('day', v_last_completed) = date_trunc('day', now()) - interval '1 day' then
        v_new_streak := v_current_streak + 1;
      else
        v_new_streak := 1;
      end if;
    else
      if date_trunc('week', v_last_completed) = date_trunc('week', now()) - interval '1 week' then
        v_new_streak := v_current_streak + 1;
      else
        v_new_streak := 1;
      end if;
    end if;

    if v_new_streak = 7 then
      v_milestone_bonus := 250;
    elsif v_new_streak = 30 then
      v_milestone_bonus := 1500;
    elsif v_new_streak = 100 then
      v_milestone_bonus := 5000;
    end if;

    update public.quests
      set last_completed_at = now(),
          streak_count = v_new_streak
      where id = quest_id;
  end if;

  v_total_xp := v_base_after_debuff + v_milestone_bonus;

  insert into public.xp_log (user_id, quest_id, xp_change, reason)
    values (v_user_id, quest_id, v_base_after_debuff, 'quest_complete');

  if v_milestone_bonus > 0 then
    insert into public.xp_log (user_id, quest_id, xp_change, reason)
      values (v_user_id, quest_id, v_milestone_bonus, 'streak_bonus_' || v_new_streak::text);
  end if;

  -- Consume any unconsumed debuffs. At apprentice/adept only the worst was
  -- applied, but we mark them all consumed, debuffs are "next completion"
  -- duration, not "next completion you actually feel".
  update public.modifiers
    set consumed_at = now()
    where user_id = v_user_id
      and type = 'debuff'
      and consumed_at is null;

  update public.profiles
    set total_xp = total_xp + v_total_xp
    where id = v_user_id
    returning total_xp into v_new_total;

  return query select v_new_total, v_total_xp, v_new_streak, v_milestone_bonus, v_debuff_pct;
end;
$$;

-- ---------------------------------------------------------------------------
-- rest_user, clears unconsumed debuffs older than 14 days. Once-per-week
-- cooldown enforced via profiles.last_rest_at. Returns the number of debuffs
-- cleared so the UI can confirm the action.
-- ---------------------------------------------------------------------------
create or replace function public.rest_user()
returns table (cleared_count int, next_rest_available_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_last_rest timestamptz;
  v_count int;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  select last_rest_at into v_last_rest from public.profiles where id = v_user_id;

  if v_last_rest is not null and now() - v_last_rest < interval '7 days' then
    raise exception 'Rest cooldown, try again after %',
      to_char(v_last_rest + interval '7 days', 'YYYY-MM-DD HH24:MI')
      using errcode = 'P0004';
  end if;

  update public.modifiers
    set consumed_at = now()
    where user_id = v_user_id
      and type = 'debuff'
      and consumed_at is null
      and created_at < now() - interval '14 days';

  get diagnostics v_count = row_count;

  update public.profiles
    set last_rest_at = now()
    where id = v_user_id;

  return query select v_count, (now() + interval '7 days');
end;
$$;
