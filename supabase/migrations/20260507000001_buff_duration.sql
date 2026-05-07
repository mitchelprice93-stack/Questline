-- Phase 4.x — buff duration by tier.
--
-- Earned buffs now persist for a tier-scaled lifetime instead of being
-- consumed on the next completion. Harder quests yield longer-lasting buffs;
-- multiple active buffs stack across the lifetime of the shortest one.

create or replace function public.buff_duration_for_tier(p_tier text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_tier
    when 'trivial' then interval '1 day'
    when 'minor' then interval '2 days'
    when 'standard' then interval '4 days'
    when 'major' then interval '7 days'
    when 'legendary' then interval '14 days'
    else interval '1 day'
  end;
$$;

-- ---------------------------------------------------------------------------
-- complete_quest — buff lifecycle reworked. Active buffs (expires_at > now)
-- now SURVIVE completion and only debuffs (plus any expired buffs) are
-- consumed. The granted-buff insert sets expires_at based on the source
-- quest's tier.
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

  select difficulty into v_difficulty from public.profiles where id = v_user_id;

  -- Buffs always sum, but only NON-expired ones count.
  select coalesce(sum(xp_modifier_pct), 0) into v_buff_pct
    from public.modifiers
    where user_id = v_user_id
      and type = 'buff'
      and consumed_at is null
      and (expires_at is null or expires_at > now());

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

  -- Consume debuffs (always next-completion duration) and any expired buffs.
  -- Active buffs (expires_at > now) survive so they keep stacking until
  -- they actually run out.
  update public.modifiers
    set consumed_at = now()
    where user_id = v_user_id
      and consumed_at is null
      and (
        type = 'debuff'
        or expires_at is null
        or expires_at <= now()
      );

  -- Insert the granted buff with a tier-scaled lifetime.
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

-- ---------------------------------------------------------------------------
-- refresh_debuffs_for — also sweeps expired buffs so the character sheet
-- doesn't keep showing them past their lifetime even before the next
-- completion runs the consume step.
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

  -- Expire any buffs whose lifetime has run out.
  update public.modifiers
    set consumed_at = now()
    where user_id = p_user_id
      and type = 'buff'
      and consumed_at is null
      and expires_at is not null
      and expires_at <= now();

  -- Untouched-quest debuffs (unchanged behavior).
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
        where user_id = p_user_id and quest_id = v_quest.id
          and source_kind = 'untouched_7d' and consumed_at is null
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
        where user_id = p_user_id and quest_id = v_quest.id
          and source_kind = 'untouched_3d' and consumed_at is null
      );
    end if;
  end loop;
end;
$$;
