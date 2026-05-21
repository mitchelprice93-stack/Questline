-- Phase 5.x, pinning quests to the top of the board.
--
-- A nullable timestamp lets us both flag a quest as pinned AND order
-- pinned quests by when they were pinned (most-recently-pinned shows
-- first inside the Pinned section). Setting to null unpins.
-- The board UI groups pinned quests above whatever organization mode
-- the chronicler picked (none / by campaign / by faction / by tier).

alter table public.quests
  add column if not exists pinned_at timestamptz;

-- Helpful index for "pinned first" board sorts. Partial index keeps it
-- tiny since most quests are not pinned.
create index if not exists quests_pinned_at_idx
  on public.quests (pinned_at desc)
  where pinned_at is not null;
