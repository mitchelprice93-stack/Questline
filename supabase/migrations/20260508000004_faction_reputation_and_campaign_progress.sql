-- Faction reputation + auto-progress for campaigns.
--
-- Two coupled features that share a trigger:
--   1. Each faction tracks a reputation_title (text, user-editable) and
--      reputation_count (integer, auto-incremented). Every quest the user
--      completes that's linked to a faction bumps that faction's count.
--      Title is "Initiate" by default; the user renames it from the
--      Character Sheet.
--   2. Each completed quest linked to a campaign auto-increments that
--      campaign's progress_pct, scaled by quest tier. Hitting 100%
--      auto-marks the campaign 'completed'.
--
-- Both run from a single AFTER UPDATE trigger on quests so complete_quest
-- doesn't have to be rewritten yet again.

-- ---- Schema ----------------------------------------------------------------

alter table public.factions
  add column if not exists reputation_title text not null default 'Initiate',
  add column if not exists reputation_count int not null default 0;

-- Backfill the count from xp_log so existing factions reflect the work
-- already done. Each 'quest_complete' row is one tally.
update public.factions f
set reputation_count = coalesce((
  select count(*)::int
  from public.xp_log xl
  join public.quests q on q.id = xl.quest_id
  where q.faction_id = f.id
    and xl.reason = 'quest_complete'
), 0);

-- ---- Trigger ---------------------------------------------------------------

create or replace function public.bump_faction_and_campaign()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_increment int;
  v_progress_after int;
begin
  -- Fires when:
  --   a) a one-shot quest moves status active → completed, OR
  --   b) a recurring quest's last_completed_at changes (each completion).
  -- Edits unrelated to completion (title, description, etc.) leave both
  -- conditions false and the trigger no-ops.
  if (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
     OR (NEW.last_completed_at IS NOT NULL
         AND NEW.last_completed_at IS DISTINCT FROM OLD.last_completed_at) then

    if NEW.faction_id is not null then
      update public.factions
        set reputation_count = reputation_count + 1
        where id = NEW.faction_id;
    end if;

    if NEW.campaign_id is not null then
      v_increment := case NEW.tier
        when 'trivial' then 2
        when 'minor' then 5
        when 'standard' then 10
        when 'major' then 20
        when 'legendary' then 40
        else 5
      end;

      -- Pre-compute the new progress so we can decide whether to flip
      -- the campaign to 'completed' in the same UPDATE.
      select least(100, progress_pct + v_increment) into v_progress_after
        from public.campaigns where id = NEW.campaign_id;

      update public.campaigns
        set progress_pct = v_progress_after,
            status = case
              when v_progress_after >= 100 and status = 'active' then 'completed'
              else status
            end
        where id = NEW.campaign_id;
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists bump_faction_and_campaign_trigger on public.quests;
create trigger bump_faction_and_campaign_trigger
  after update on public.quests
  for each row
  execute function public.bump_faction_and_campaign();

-- ---- apply_character_creation: read reputation_title from input ------------
-- AI may supply it per-faction; if absent we fall back to 'Initiate'.

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
    insert into public.factions (user_id, name, real_world_domain, reputation_title)
      values (
        v_user_id,
        v_faction ->> 'name',
        v_faction ->> 'real_world_domain',
        coalesce(nullif(v_faction ->> 'reputation_title', ''), 'Initiate')
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
