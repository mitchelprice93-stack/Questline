-- Phase 5.x, expand quest recurrence beyond daily/weekly.
--
-- Adds monthly, yearly, and custom (every-N-days/weeks/months) cadences.
-- Custom requires two new columns to carry the interval + unit pair.
--
-- All four existing/new recurrence handlers (the period-collision check
-- and the streak math) get extended to cover the new values. complete_quest
-- is the only function that needs PL/pgSQL surgery, the buff/debuff
-- engines reference `v_recurrence` only for the same two checks, both of
-- which now live inside complete_quest's logic. (debuff_engine.sql doesn't
-- override complete_quest after this migration runs.)

-- 1. New columns for custom-cadence config.
alter table public.quests
  add column if not exists recurrence_interval int,
  add column if not exists recurrence_unit text;

-- 2. Constrain unit to known values + custom-only invariants.
alter table public.quests
  drop constraint if exists quests_recurrence_check;

alter table public.quests
  add constraint quests_recurrence_check
    check (
      recurrence is null
      or recurrence in ('daily', 'weekly', 'monthly', 'yearly', 'custom')
    );

alter table public.quests
  drop constraint if exists quests_recurrence_unit_check;

alter table public.quests
  add constraint quests_recurrence_unit_check
    check (
      recurrence_unit is null
      or recurrence_unit in ('days', 'weeks', 'months')
    );

-- Custom recurrence requires BOTH interval (positive int) and unit set.
-- Non-custom recurrences must leave both null.
alter table public.quests
  drop constraint if exists quests_recurrence_custom_invariant;

alter table public.quests
  add constraint quests_recurrence_custom_invariant
    check (
      (recurrence = 'custom' and recurrence_interval is not null and recurrence_interval > 0 and recurrence_unit is not null)
      or (recurrence <> 'custom' and recurrence_interval is null and recurrence_unit is null)
      or recurrence is null
    );

-- 3. Recreate complete_quest with all five cadences + custom interval math.
drop function if exists public.complete_quest(uuid);

create function public.complete_quest(quest_id uuid)
returns table (
  new_total_xp bigint,
  xp_change int,
  new_streak int,
  milestone_bonus int,
  net_modifier_pct int,
  buff_granted text
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_xp_reward int;
  v_tier text;
  v_recurrence text;
  v_recurrence_interval int;
  v_recurrence_unit text;
  v_custom_interval interval;
  v_last_completed timestamptz;
  v_current_streak int;
  v_deadline timestamptz;
  v_objectives jsonb;
  v_granted_name text;
  v_granted_desc text;
  v_granted_pct int;
  v_granted_cond text;
  v_new_streak int := 0;
  v_milestone_bonus int := 0;
  v_difficulty text;
  v_debuff_pct int := 0;
  v_buff_pct int := 0;
  v_net_pct int := 0;
  v_base_after int;
  v_total_xp int;
  v_new_total bigint;
  v_objective record;
  v_all_objectives_done boolean;
  v_condition_met boolean := false;
  v_buff_granted text := null;
begin
  select
    user_id, xp_reward, tier, recurrence, recurrence_interval, recurrence_unit,
    last_completed_at, streak_count, deadline, objectives,
    granted_buff_name, granted_buff_description, granted_buff_pct, granted_buff_condition
  into
    v_user_id, v_xp_reward, v_tier, v_recurrence, v_recurrence_interval, v_recurrence_unit,
    v_last_completed, v_current_streak, v_deadline, v_objectives,
    v_granted_name, v_granted_desc, v_granted_pct, v_granted_cond
  from public.quests
  where id = quest_id and status = 'active'
  for update;

  if v_user_id is null then
    raise exception 'Quest not found or not active' using errcode = 'P0002';
  end if;

  -- Reconcile any pending debuffs before computing the modifier sum.
  perform public.refresh_debuffs_for(v_user_id);

  select difficulty into v_difficulty from public.profiles where id = v_user_id;

  -- Buff aggregation.
  select coalesce(sum(xp_modifier_pct), 0) into v_buff_pct
    from public.modifiers
    where user_id = v_user_id and type = 'buff' and consumed_at is null
      and (expires_at is null or expires_at > now());

  -- Debuff aggregation by difficulty.
  if v_difficulty in ('master', 'legendary') then
    select coalesce(sum(xp_modifier_pct), 0) into v_debuff_pct
      from public.modifiers
      where user_id = v_user_id and type = 'debuff' and consumed_at is null;
  else
    select coalesce(min(xp_modifier_pct), 0) into v_debuff_pct
      from public.modifiers
      where user_id = v_user_id and type = 'debuff' and consumed_at is null;
  end if;

  v_net_pct := v_buff_pct + v_debuff_pct;
  if v_net_pct < -100 then v_net_pct := -100; end if;
  v_base_after := greatest(0, round(v_xp_reward * (1 + v_net_pct::numeric / 100)));

  -- Pre-compute the custom interval once.
  if v_recurrence = 'custom' then
    v_custom_interval := (v_recurrence_interval || ' ' || v_recurrence_unit)::interval;
  end if;

  -- One-shot vs recurring branch.
  if v_recurrence is null then
    update public.quests
      set status = 'completed', completed_at = now()
      where id = quest_id;
  else
    -- Period-collision check: reject same-period completion.
    if v_last_completed is not null then
      if v_recurrence = 'daily'
         and date_trunc('day', v_last_completed) = date_trunc('day', now()) then
        raise exception 'Quest already completed for today' using errcode = 'P0003';
      elsif v_recurrence = 'weekly'
         and date_trunc('week', v_last_completed) = date_trunc('week', now()) then
        raise exception 'Quest already completed for this week' using errcode = 'P0003';
      elsif v_recurrence = 'monthly'
         and date_trunc('month', v_last_completed) = date_trunc('month', now()) then
        raise exception 'Quest already completed for this month' using errcode = 'P0003';
      elsif v_recurrence = 'yearly'
         and date_trunc('year', v_last_completed) = date_trunc('year', now()) then
        raise exception 'Quest already completed for this year' using errcode = 'P0003';
      elsif v_recurrence = 'custom'
         and now() < v_last_completed + v_custom_interval then
        raise exception 'Quest already completed for this cycle' using errcode = 'P0003';
      end if;
    end if;

    -- Streak math: continue if previous completion fell in the immediately
    -- prior period, reset to 1 otherwise. First completion always = 1.
    if v_last_completed is null then
      v_new_streak := 1;
    elsif v_recurrence = 'daily' then
      v_new_streak := case
        when date_trunc('day', v_last_completed) = date_trunc('day', now()) - interval '1 day'
        then v_current_streak + 1 else 1 end;
    elsif v_recurrence = 'weekly' then
      v_new_streak := case
        when date_trunc('week', v_last_completed) = date_trunc('week', now()) - interval '1 week'
        then v_current_streak + 1 else 1 end;
    elsif v_recurrence = 'monthly' then
      v_new_streak := case
        when date_trunc('month', v_last_completed) = date_trunc('month', now()) - interval '1 month'
        then v_current_streak + 1 else 1 end;
    elsif v_recurrence = 'yearly' then
      v_new_streak := case
        when date_trunc('year', v_last_completed) = date_trunc('year', now()) - interval '1 year'
        then v_current_streak + 1 else 1 end;
    else  -- custom
      -- Continue if the completion lands in the next window (last + interval,
      -- last + 2*interval]. Beyond 2 intervals, the chronicler missed a
      -- window and the streak resets.
      v_new_streak := case
        when now() < v_last_completed + (v_custom_interval * 2)
        then v_current_streak + 1 else 1 end;
    end if;

    if v_new_streak = 7 then v_milestone_bonus := 250;
    elsif v_new_streak = 30 then v_milestone_bonus := 1500;
    elsif v_new_streak = 100 then v_milestone_bonus := 5000;
    end if;

    update public.quests
      set last_completed_at = now(), streak_count = v_new_streak
      where id = quest_id;
  end if;

  v_total_xp := v_base_after + v_milestone_bonus;

  insert into public.xp_log (user_id, quest_id, xp_change, reason)
    values (v_user_id, quest_id, v_base_after, 'quest_complete');

  if v_milestone_bonus > 0 then
    insert into public.xp_log (user_id, quest_id, xp_change, reason)
      values (v_user_id, quest_id, v_milestone_bonus, 'streak_bonus_' || v_new_streak::text);
  end if;

  -- Consume debuffs and any expired buffs.
  update public.modifiers
    set consumed_at = now()
    where user_id = v_user_id
      and consumed_at is null
      and (type = 'debuff' or expires_at is null or expires_at <= now());

  -- Granted-buff insertion.
  if v_granted_name is not null and v_granted_pct is not null and v_granted_cond is not null then
    if v_granted_cond = 'on_complete' then
      v_condition_met := true;
    elsif v_granted_cond = 'on_time' then
      v_condition_met := v_deadline is null or now() <= v_deadline;
    elsif v_granted_cond = 'all_objectives' then
      v_all_objectives_done := true;
      for v_objective in select * from jsonb_array_elements(coalesce(v_objectives, '[]'::jsonb)) loop
        if not coalesce((v_objective.value->>'completed')::boolean, false) then
          v_all_objectives_done := false;
          exit;
        end if;
      end loop;
      v_condition_met := v_all_objectives_done;
    end if;

    if v_condition_met then
      insert into public.modifiers (
        user_id, type, name, effect_description, xp_modifier_pct,
        source_kind, quest_id, expires_at
      )
      values (
        v_user_id, 'buff', v_granted_name, v_granted_desc, v_granted_pct,
        case v_granted_cond
          when 'on_time' then 'quest_on_time'
          when 'all_objectives' then 'quest_all_objectives'
          else 'quest_on_complete'
        end,
        quest_id,
        now() + public.buff_duration_for_tier(v_tier)
      );
      v_buff_granted := v_granted_name;
    end if;
  end if;

  update public.profiles
    set total_xp = total_xp + v_total_xp
    where id = v_user_id
    returning total_xp into v_new_total;

  return query select v_new_total, v_total_xp, v_new_streak, v_milestone_bonus, v_net_pct, v_buff_granted;
end;
$$;
