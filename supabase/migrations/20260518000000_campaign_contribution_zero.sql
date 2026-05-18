-- Phase 5.x — allow 0% campaign contribution.
--
-- The original Option B migration enforced a 1..100 range, which crashed
-- the new-quest form when a chronicler explicitly entered 0 (intent: "link
-- this quest to the campaign but it shouldn't actually move the bar").
-- Relax the range to 0..100. The trigger already handles 0 correctly:
--   coalesce(NEW.campaign_contribution_pct, 5) returns 0, not 5, because
--   coalesce only substitutes for NULL; and least(100, progress + 0) is a
--   no-op on progress. So no trigger change is needed — only the CHECK.

alter table public.quests
  drop constraint if exists quests_campaign_contribution_range;

alter table public.quests
  add constraint quests_campaign_contribution_range
    check (
      campaign_contribution_pct is null
      or (campaign_contribution_pct >= 0 and campaign_contribution_pct <= 100)
    );
