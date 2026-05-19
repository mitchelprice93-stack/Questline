-- Phase 1.5: atomic quest action RPCs.
--
-- Both functions run as the calling user (security invoker), so RLS policies
-- on quests / xp_log / profiles still apply, a user cannot act on someone
-- else's quests because the policies on `select`/`update` filter the rows
-- before the function sees them.

-- ---------------------------------------------------------------------------
-- complete_quest: marks a quest completed, appends to xp_log, increments
-- profile.total_xp atomically. Returns the new total_xp + the xp granted.
-- Buffs / debuffs are NOT applied here, that's caller-side via the XP engine
-- once the modifiers system goes live.
-- ---------------------------------------------------------------------------
create or replace function public.complete_quest(quest_id uuid)
returns table (new_total_xp bigint, xp_change int)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_xp_reward int;
  v_new_total bigint;
begin
  -- Lock the active row. RLS filters to the caller's quests, so a foreign
  -- quest_id simply produces no rows -> "not found".
  select user_id, xp_reward into v_user_id, v_xp_reward
    from public.quests
    where id = quest_id and status = 'active'
    for update;

  if v_user_id is null then
    raise exception 'Quest not found or not active' using errcode = 'P0002';
  end if;

  update public.quests
    set status = 'completed', completed_at = now()
    where id = quest_id;

  insert into public.xp_log (user_id, quest_id, xp_change, reason)
    values (v_user_id, quest_id, v_xp_reward, 'quest_complete');

  update public.profiles
    set total_xp = total_xp + v_xp_reward
    where id = v_user_id
    returning total_xp into v_new_total;

  return query select v_new_total, v_xp_reward;
end;
$$;

-- ---------------------------------------------------------------------------
-- abandon_quest: marks an active quest abandoned. No XP change. The "Mark of
-- the Forsaken" debuff (spec §4.2) is applied separately by the debuff engine.
-- ---------------------------------------------------------------------------
create or replace function public.abandon_quest(quest_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.quests
    set status = 'abandoned'
    where id = quest_id and status = 'active';

  if not found then
    raise exception 'Quest not found or not active' using errcode = 'P0002';
  end if;
end;
$$;
