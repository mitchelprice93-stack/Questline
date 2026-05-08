-- Phase 5.1 — freemium quest cap.
--
-- Free-tier users can hold at most 5 active quests at any one time.
-- Hero-tier (paid) users are uncapped. The check runs as a BEFORE INSERT
-- trigger on quests so it's enforced server-side; the client also looks
-- at the count for UX, but the server is the source of truth.

create or replace function public.enforce_quest_cap()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tier text;
  v_status text;
  v_expires timestamptz;
  v_active_count int;
begin
  -- Only cap inserts that land in 'active' status. Completed/abandoned
  -- inserts (e.g. importer paths in the future) are unaffected.
  if new.status is distinct from 'active' then
    return new;
  end if;

  select tier, status, expires_at into v_tier, v_status, v_expires
    from public.subscriptions
    where user_id = new.user_id;

  -- No subscription row → free tier. Hero tier requires status='active' or
  -- 'trial' AND expires_at in the future (or null = perpetual). Anything
  -- else falls back to free.
  if v_tier = 'hero'
     and (v_status = 'active' or v_status = 'trial')
     and (v_expires is null or v_expires > now())
  then
    return new;  -- uncapped
  end if;

  select count(*) into v_active_count
    from public.quests
    where user_id = new.user_id and status = 'active';

  if v_active_count >= 5 then
    raise exception 'Quest cap reached: 5 active quests on the free tier. Upgrade to Hero to inscribe more.'
      using errcode = 'P0005';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_quest_cap_trigger on public.quests;
create trigger enforce_quest_cap_trigger
  before insert on public.quests
  for each row
  execute function public.enforce_quest_cap();
