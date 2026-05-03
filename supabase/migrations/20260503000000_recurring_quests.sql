-- Phase 4.1: recurring quests + streak bonuses.
--
-- Daily / weekly quests stay in 'active' state; we track when they were last
-- completed so the UI can show a cooldown and the RPC can compute streaks.
-- Streak milestones (7/30/100) award one-time XP bonuses on top of the
-- normal tier reward.

alter table public.quests add column if not exists last_completed_at timestamptz;

-- The return type of complete_quest is changing (added new_streak,
-- milestone_bonus). Postgres doesn't allow CREATE OR REPLACE for return-type
-- changes, so drop first.
drop function if exists public.complete_quest(uuid);

create function public.complete_quest(quest_id uuid)
returns table (
  new_total_xp bigint,
  xp_change int,
  new_streak int,
  milestone_bonus int
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
  v_total_xp int;
  v_new_total bigint;
begin
  -- Lock the active row. RLS filters to the caller's quests, so a foreign
  -- quest_id simply produces no rows -> "not found".
  select user_id, xp_reward, recurrence, last_completed_at, streak_count
    into v_user_id, v_xp_reward, v_recurrence, v_last_completed, v_current_streak
    from public.quests
    where id = quest_id and status = 'active'
    for update;

  if v_user_id is null then
    raise exception 'Quest not found or not active' using errcode = 'P0002';
  end if;

  -- One-shot quest: mark completed terminally, award base XP, done.
  if v_recurrence is null then
    update public.quests
      set status = 'completed', completed_at = now()
      where id = quest_id;

    insert into public.xp_log (user_id, quest_id, xp_change, reason)
      values (v_user_id, quest_id, v_xp_reward, 'quest_complete');

    update public.profiles
      set total_xp = total_xp + v_xp_reward
      where id = v_user_id
      returning total_xp into v_new_total;

    return query select v_new_total, v_xp_reward, 0, 0;
    return;
  end if;

  -- Recurring quest: reject double-completion in the same period.
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

  -- Streak: continued if previous completion was in the immediately prior
  -- period, otherwise reset to 1. First completion always sets streak to 1.
  if v_last_completed is null then
    v_new_streak := 1;
  elsif v_recurrence = 'daily' then
    if date_trunc('day', v_last_completed) = date_trunc('day', now()) - interval '1 day' then
      v_new_streak := v_current_streak + 1;
    else
      v_new_streak := 1;
    end if;
  else  -- weekly
    if date_trunc('week', v_last_completed) = date_trunc('week', now()) - interval '1 week' then
      v_new_streak := v_current_streak + 1;
    else
      v_new_streak := 1;
    end if;
  end if;

  -- Milestone bonuses fire only when the streak crosses the exact threshold.
  -- These constants must stay in sync with STREAK_BONUSES in lib/engine/xp.ts.
  if v_new_streak = 7 then
    v_milestone_bonus := 250;
  elsif v_new_streak = 30 then
    v_milestone_bonus := 1500;
  elsif v_new_streak = 100 then
    v_milestone_bonus := 5000;
  end if;

  v_total_xp := v_xp_reward + v_milestone_bonus;

  update public.quests
    set last_completed_at = now(),
        streak_count = v_new_streak
    where id = quest_id;

  insert into public.xp_log (user_id, quest_id, xp_change, reason)
    values (v_user_id, quest_id, v_xp_reward, 'quest_complete');

  if v_milestone_bonus > 0 then
    insert into public.xp_log (user_id, quest_id, xp_change, reason)
      values (
        v_user_id,
        quest_id,
        v_milestone_bonus,
        'streak_bonus_' || v_new_streak::text
      );
  end if;

  update public.profiles
    set total_xp = total_xp + v_total_xp
    where id = v_user_id
    returning total_xp into v_new_total;

  return query select v_new_total, v_total_xp, v_new_streak, v_milestone_bonus;
end;
$$;
