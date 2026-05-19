-- Phase 1.4 follow-up, wire the difficulty multiplier into complete_quest.
--
-- The multiplier table has existed in lib/engine/xp.ts since Phase 1, but
-- the SQL function that actually awards XP never read profile.difficulty.
-- That meant changing difficulty in Settings was cosmetic, the same
-- xp_reward landed regardless. This migration plugs the hole.
--
-- Multipliers (mirror lib/engine/xp.ts DIFFICULTY_MULT, keep in sync):
--   apprentice  1.5    (easiest, fastest leveling)
--   adept       1.25
--   master      1.0    (baseline)
--   legendary   0.75   (hardest, slowest leveling)
--
-- Order of operations on completion:
--   base_after = round(xp_reward * difficulty_mult * (1 + net_modifier_pct/100))
-- Streak milestone bonuses are awarded on top, unaffected by difficulty
-- (a milestone bonus is a milestone regardless of how hard you set the
-- game).

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
  v_difficulty_mult numeric;
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
  v_new_expires timestamptz;
  v_existing_buff_id uuid;
  v_existing_expires timestamptz;
begin
  select
    user_id, xp_reward, tier, recurrence, last_completed_at, streak_count,
    deadline, objectives,
    granted_buff_name, granted_buff_description, granted_buff_pct,
    granted_buff_condition
  into
    v_user_id, v_xp_reward, v_tier, v_recurrence, v_last_completed, v_current_streak,
    v_deadline, v_objectives,
    v_granted_name, v_granted_desc, v_granted_pct, v_granted_cond
  from public.quests
  where id = quest_id and status = 'active'
  for update;

  if v_user_id is null then
    raise exception 'Quest not found or not active' using errcode = 'P0002';
  end if;

  perform public.refresh_debuffs_for(v_user_id);

  select difficulty into v_difficulty from public.profiles where id = v_user_id;

  -- Difficulty multiplier, easier difficulty = more XP per quest.
  v_difficulty_mult := case v_difficulty
    when 'apprentice' then 1.5
    when 'adept' then 1.25
    when 'master' then 1.0
    when 'legendary' then 0.75
    else 1.0
  end;

  select coalesce(sum(xp_modifier_pct), 0) into v_buff_pct
    from public.modifiers
    where user_id = v_user_id
      and type = 'buff'
      and consumed_at is null
      and (expires_at is null or expires_at > now());

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

  -- Apply difficulty multiplier first, then buff/debuff modifiers on top.
  v_base_after := greatest(
    0,
    round(v_xp_reward * v_difficulty_mult * (1 + v_net_pct::numeric / 100))
  );

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

  -- Consume debuffs and any expired buffs. Active buffs survive.
  update public.modifiers
    set consumed_at = now()
    where user_id = v_user_id
      and consumed_at is null
      and (
        type = 'debuff'
        or expires_at is null
        or expires_at <= now()
      );

  -- Insert OR refresh the granted buff. Same-name active buff bumps its
  -- expires_at instead of creating a duplicate row.
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
      v_new_expires := now() + public.buff_duration_for_tier(v_tier);

      select id, expires_at into v_existing_buff_id, v_existing_expires
        from public.modifiers
        where user_id = v_user_id
          and type = 'buff'
          and consumed_at is null
          and (expires_at is null or expires_at > now())
          and lower(name) = lower(v_granted_name)
        order by expires_at desc nulls first
        limit 1;

      if v_existing_buff_id is not null then
        update public.modifiers
          set expires_at = greatest(v_existing_expires, v_new_expires)
          where id = v_existing_buff_id;
      else
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
          v_new_expires
        );
      end if;
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
