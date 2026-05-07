-- Phase 4.4: quest log + history.
--
-- Track when an active quest was abandoned so the Abandoned tab can sort and
-- display it the same way Completed sorts on completed_at.

alter table public.quests add column if not exists abandoned_at timestamptz;

create or replace function public.abandon_quest(quest_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.quests
    set status = 'abandoned', abandoned_at = now()
    where id = quest_id and status = 'active';

  if not found then
    raise exception 'Quest not found or not active' using errcode = 'P0002';
  end if;
end;
$$;
