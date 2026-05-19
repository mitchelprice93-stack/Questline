-- Safety pass on the auth.users → public.profiles wiring.
--
-- User dogfooding hit a foreign-key violation on `factions.user_id` during
-- character creation, meaning no profiles row existed for their new auth.users
-- row, the on_auth_user_created trigger didn't fire. Three defenses:
--
--   1. Backfill any auth.users row that lacks a matching profile.
--   2. Re-install handle_new_user() + the trigger so future signups always
--      get a profile (idempotent, works even if the trigger is already there).
--   3. Make apply_character_creation defensive: insert the profile if it's
--      somehow still missing at call time, then proceed with the update.

-- 1. Backfill.
insert into public.profiles (id)
select u.id from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- 2. Re-install trigger (idempotent).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3. Defensive apply_character_creation, same body as the original RPC,
-- with an `insert ... on conflict do nothing` ahead of the update so the
-- profile row is guaranteed to exist by the time we lock it.
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

  -- Defensive: ensure the profile row exists. Normally on_auth_user_created
  -- handles this. RLS on profiles permits the user to insert their own row.
  insert into public.profiles (id) values (v_user_id) on conflict do nothing;

  -- Lock the profile row before the duplicate check, prevents a double-submit
  -- racing between two clients.
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
