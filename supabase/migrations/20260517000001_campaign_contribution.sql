-- Phase 5.x — per-quest campaign contribution (Option B).
--
-- Replaces the tier-scaled auto-advancement in bump_faction_and_campaign
-- with a per-quest, user-set contribution percentage. The chronicler
-- picks how much each quest moves the linked campaign's progress bar.
-- Campaign auto-completes when progress reaches 100% (unchanged).
--
-- Migration sequence:
--   1. Add the column with a CHECK (1..100 when campaign_id is set, null
--      when not).
--   2. Backfill existing quests using the OLD tier-scaled values so
--      historical behavior is preserved.
--   3. Replace the trigger to read the new column instead of computing
--      from tier.

-- 1. New column with invariant: set iff campaign_id is set, range 1-100.
alter table public.quests
  add column if not exists campaign_contribution_pct int;

-- Constraints: range 1..100 when present, must be set when campaign linked,
-- must be null when no campaign.
alter table public.quests
  drop constraint if exists quests_campaign_contribution_range;

alter table public.quests
  add constraint quests_campaign_contribution_range
    check (
      campaign_contribution_pct is null
      or (campaign_contribution_pct >= 1 and campaign_contribution_pct <= 100)
    );

-- Looser pairing rule: contribution_pct can only be set when campaign_id
-- is also set, BUT it's allowed to be null even when campaign_id is set.
-- The trigger coalesces to a default in that case (see below). This
-- relaxation matters for deployment ordering — old client code that
-- doesn't know about the new column can still insert quests with
-- campaigns; the trigger fills in the default.
alter table public.quests
  drop constraint if exists quests_campaign_contribution_pairing;

alter table public.quests
  add constraint quests_campaign_contribution_pairing
    check (
      campaign_contribution_pct is null
      or campaign_id is not null
    );

-- 2. Backfill existing quests using the OLD tier scale, so historical
-- quests keep their previous contribution amounts.
update public.quests
set campaign_contribution_pct = case tier
  when 'trivial' then 2
  when 'minor' then 5
  when 'standard' then 10
  when 'major' then 20
  when 'legendary' then 40
  else 5
end
where campaign_id is not null and campaign_contribution_pct is null;

-- 3. New trigger function — uses the per-quest column directly.
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
  --   b) a recurring quest's last_completed_at changes.
  if (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
     OR (NEW.last_completed_at IS NOT NULL
         AND NEW.last_completed_at IS DISTINCT FROM OLD.last_completed_at) then

    if NEW.faction_id is not null then
      update public.factions
        set reputation_count = reputation_count + 1
        where id = NEW.faction_id;
    end if;

    if NEW.campaign_id is not null then
      -- Per-quest contribution (Option B). The CHECK constraint guarantees
      -- a value here when campaign_id is set; fall back to 5 defensively
      -- in case of legacy rows that escaped the backfill.
      v_increment := coalesce(NEW.campaign_contribution_pct, 5);

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
