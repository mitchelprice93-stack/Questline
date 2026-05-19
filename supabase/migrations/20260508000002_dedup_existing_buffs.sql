-- Phase 5.x, one-time cleanup of stacked same-name buffs.
--
-- complete_quest already refreshes-instead-of-stacks for new buffs
-- (migration 20260507000005), but every buff a user earned BEFORE that
-- migration is still sitting in modifiers as a separate row. Real users
-- show double-digit stacks of "Wanderer's Stride" or whatever the AI
-- defaulted to.
--
-- For each (user_id, lowercase name) group with multiple unconsumed
-- buffs, keep the row with the latest expires_at (or NULL = forever)
-- and mark the rest consumed_at = now(). The keeper's expires_at is
-- already the longest of the bunch, so we don't need to bump it.

with ranked as (
  select id,
    row_number() over (
      partition by user_id, lower(name)
      order by expires_at desc nulls first, created_at desc
    ) as rn
  from public.modifiers
  where type = 'buff'
    and consumed_at is null
)
update public.modifiers m
set consumed_at = now()
from ranked r
where m.id = r.id and r.rn > 1;
