-- Phase 4.x — buff engine.
--
-- The inverse of debuffs. Each quest can declare a "granted buff" with a
-- condition; meeting the condition on completion inserts a one-shot buff
-- modifier the user can carry into the next completion. Same modifiers
-- table, same lifecycle (consumed_at), opposite sign on xp_modifier_pct.

alter table public.quests
  add column if not exists granted_buff_name text,
  add column if not exists granted_buff_description text,
  add column if not exists granted_buff_pct int,
  add column if not exists granted_buff_condition text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'quests_granted_buff_condition_check'
  ) then
    alter table public.quests
      add constraint quests_granted_buff_condition_check
      check (granted_buff_condition is null or granted_buff_condition in (
        'on_complete', 'on_time', 'all_objectives'
      ));
  end if;
end $$;

-- Extend the modifiers source_kind enum to cover buff sources without
-- losing the existing debuff values.
do $$
begin
  -- Drop the prior constraint if present so we can recreate with a wider set.
  if exists (
    select 1 from pg_constraint where conname = 'modifiers_source_kind_check'
  ) then
    alter table public.modifiers drop constraint modifiers_source_kind_check;
  end if;

  alter table public.modifiers
    add constraint modifiers_source_kind_check
    check (source_kind is null or source_kind in (
      'untouched_3d', 'untouched_7d', 'abandoned', 'manual_buff',
      'quest_on_complete', 'quest_on_time', 'quest_all_objectives'
    ));
end $$;

-- ---------------------------------------------------------------------------
-- complete_quest — extended once more, this time to:
--   1. Apply unconsumed BUFFS as well as debuffs to the base reward.
--      Buffs always sum (regardless of difficulty); debuffs still follow
--      the apprentice/adept "worst only" vs master/legendary "stack" rule.
--   2. Consume all unconsumed modifiers (both buffs and debuffs).
--   3. If the completing quest declares a granted_buff, evaluate its
--      condition. If satisfied, insert a fresh buff modifier for the
--      *next* completion.
-- ---------------------------------------------------------------------------
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
  v_recurrence text;
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
    user_id, xp_reward, recurrence, last_completed_at, streak_count,
    deadline, objectives,
    granted_buff_name, granted_buff_description, granted_buff_pct,
    granted_buff_condition
  into
    v_user_id, v_xp_reward, v_recurrence, v_last_completed, v_current_streak,
    v_deadline, v_objectives,
    v_granted_name, v_granted_desc, v_granted_pct, v_granted_cond
  from public.quests
  where id = quest_id and status = 'active'
  for update;

  if v_user_id is null then
    raise exception 'Quest not found or not active' using errcode = 'P0002';
  end if;

  select difficulty into v_difficulty from public.profiles where id = v_user_id;

  -- Buffs always sum.
  select coalesce(sum(xp_modifier_pct), 0) into v_buff_pct
    from public.modifiers
    where user_id = v_user_id
      and type = 'buff'
      and consumed_at is null;

  -- Debuffs follow the difficulty rule.
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

  -- Recurring vs one-shot streak math.
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
      else v_new_streak := 1; end if;
    else
      if date_trunc('week', v_last_completed) = date_trunc('week', now()) - interval '1 week' then
        v_new_streak := v_current_streak + 1;
      else v_new_streak := 1; end if;
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

  -- Consume every unconsumed modifier — both buffs and debuffs are
  -- "next completion" duration by default, and this was that completion.
  update public.modifiers
    set consumed_at = now()
    where user_id = v_user_id and consumed_at is null;

  -- Evaluate the quest's granted-buff condition and insert a fresh buff
  -- modifier if it's satisfied.
  if v_granted_name is not null and v_granted_pct is not null and v_granted_cond is not null then
    if v_granted_cond = 'on_complete' then
      v_condition_met := true;
    elsif v_granted_cond = 'on_time' then
      v_condition_met := v_deadline is null or now() <= v_deadline;
    elsif v_granted_cond = 'all_objectives' then
      -- Vacuously true if there are no objectives.
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
        user_id, type, name, effect_description, xp_modifier_pct, source_kind, quest_id
      )
      values (
        v_user_id, 'buff', v_granted_name, v_granted_desc, v_granted_pct,
        case v_granted_cond
          when 'on_time' then 'quest_on_time'
          when 'all_objectives' then 'quest_all_objectives'
          else 'quest_on_complete'
        end,
        quest_id
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
