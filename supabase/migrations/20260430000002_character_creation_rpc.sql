-- Phase 2.3: atomic apply_character_creation RPC.
--
-- Given the AI's parsed character sheet, write the chronicler's profile
-- (name, title, starting level, total_xp), insert their factions, and
-- insert their campaigns, all in one transaction. One-shot: enforces the
-- spec's "1 character creation per lifetime" by refusing if the calling
-- user's profile already has a character_name.
--
-- Runs security invoker so RLS still applies; auth.uid() is the only
-- user_id this function can touch.

create or replace function public.apply_character_creation(
  p_character_name text,
  p_character_title text,
  p_starting_level int,
  p_total_xp bigint,
  p_factions jsonb,
  p_campaigns jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_faction jsonb;
  v_campaign jsonb;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if p_starting_level < 1 or p_starting_level > 50 then
    raise exception 'Starting level out of range' using errcode = '22023';
  end if;

  if p_total_xp < 0 then
    raise exception 'total_xp cannot be negative' using errcode = '22023';
  end if;

  -- Lock the profile row before checking, prevents a double-submit racing
  -- between two clients.
  perform 1 from public.profiles where id = v_user_id for update;

  if exists (
    select 1 from public.profiles
    where id = v_user_id and character_name is not null
  ) then
    raise exception 'Character already created' using errcode = '23505';
  end if;

  update public.profiles
    set character_name = p_character_name,
        character_title = nullif(p_character_title, ''),
        level = p_starting_level,
        total_xp = p_total_xp
    where id = v_user_id;

  for v_faction in select * from jsonb_array_elements(coalesce(p_factions, '[]'::jsonb)) loop
    insert into public.factions (user_id, name, real_world_domain)
      values (
        v_user_id,
        v_faction ->> 'name',
        v_faction ->> 'real_world_domain'
      );
  end loop;

  for v_campaign in select * from jsonb_array_elements(coalesce(p_campaigns, '[]'::jsonb)) loop
    insert into public.campaigns (user_id, arc_name, real_world_goal)
      values (
        v_user_id,
        v_campaign ->> 'arc_name',
        v_campaign ->> 'real_world_goal'
      );
  end loop;
end;
$$;
