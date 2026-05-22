-- Phase 5.x, user-controlled display order for factions and campaigns.
--
-- The character sheet renders each chronicler's factions and campaigns as
-- a draggable list. display_order tracks their preferred sequence so the
-- order persists across sessions. Backfilled here using creation order so
-- existing chroniclers don't see their lists scrambled by the migration.

alter table public.factions
  add column if not exists display_order int not null default 0;

alter table public.campaigns
  add column if not exists display_order int not null default 0;

-- Backfill: assign sequential display_order based on existing creation
-- order, per user. Brand-new rows added after this migration default to 0
-- and the client bumps display_order on insert (or relies on the natural
-- created_at tiebreak in the list query).
update public.factions f
set display_order = sub.row_num - 1
from (
  select id, row_number() over (partition by user_id order by created_at) as row_num
  from public.factions
) sub
where f.id = sub.id;

update public.campaigns c
set display_order = sub.row_num - 1
from (
  select id, row_number() over (partition by user_id order by created_at) as row_num
  from public.campaigns
) sub
where c.id = sub.id;

create index if not exists factions_user_display_order_idx
  on public.factions (user_id, display_order);

create index if not exists campaigns_user_display_order_idx
  on public.campaigns (user_id, display_order);
