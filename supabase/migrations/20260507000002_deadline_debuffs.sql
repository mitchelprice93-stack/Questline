-- Phase 4.x, debuff trigger reworked: deadline-miss instead of "untouched".
--
-- The 3-day / 7-day "you let it sit" debuffs punished long-tail work
-- (year-long campaigns) for being long-tail. Deadlines are user-set
-- commitments, so missing one is a meaningful failure; not having one
-- means there's nothing to miss. Source kinds renamed to reflect the
-- new cause; the modifier names stay since "Cobwebs" / "Curse" still
-- fit the feeling of letting a vow slip.

-- Allow the new source_kind values. Legacy 'untouched_*' values stay
-- in the constraint for any historical rows that might still be sitting
-- around unconsumed; they'll naturally get consumed at the next
-- completion and never get inserted again.
do $$
begin
  if exists (
    select 1 from pg_constraint where conname = 'modifiers_source_kind_check'
  ) then
    alter table public.modifiers drop constraint modifiers_source_kind_check;
  end if;

  alter table public.modifiers
    add constraint modifiers_source_kind_check
    check (source_kind is null or source_kind in (
      -- legacy (no longer inserted)
      'untouched_3d', 'untouched_7d',
      -- current
      'abandoned', 'manual_buff',
      'quest_on_complete', 'quest_on_time', 'quest_all_objectives',
      'deadline_missed', 'deadline_long_overdue'
    ));
end $$;

-- ---------------------------------------------------------------------------
-- refresh_debuffs_for, same idempotent shape, now keyed off deadlines.
--   1+ day overdue   → Cobwebs of Procrastination (-10%)
--   7+ days overdue  → Curse of the Idle Blade   (-50%)
-- A quest with no deadline is exempt from these checks entirely.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_debuffs_for(p_user_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_quest record;
  v_overdue_days numeric;
begin
  if auth.uid() <> p_user_id then
    raise exception 'Cannot refresh debuffs for another user' using errcode = '42501';
  end if;

  -- Expire any buffs whose lifetime has run out.
  update public.modifiers
    set consumed_at = now()
    where user_id = p_user_id
      and type = 'buff'
      and consumed_at is null
      and expires_at is not null
      and expires_at <= now();

  -- Walk active quests with a deadline that's already in the past. Quests
  -- without a deadline are skipped (long-running campaigns are fine).
  for v_quest in
    select id, deadline
    from public.quests
    where user_id = p_user_id
      and status = 'active'
      and deadline is not null
      and deadline < now()
  loop
    v_overdue_days := extract(epoch from (now() - v_quest.deadline)) / 86400;

    if v_overdue_days >= 7 then
      insert into public.modifiers (
        user_id, type, name, effect_description, xp_modifier_pct, source_kind, quest_id
      )
      select p_user_id, 'debuff', 'Curse of the Idle Blade',
             'XP halved on the next completion, the deadline has long since passed.',
             -50, 'deadline_long_overdue', v_quest.id
      where not exists (
        select 1 from public.modifiers
        where user_id = p_user_id and quest_id = v_quest.id
          and source_kind = 'deadline_long_overdue' and consumed_at is null
      );
    elsif v_overdue_days >= 1 then
      insert into public.modifiers (
        user_id, type, name, effect_description, xp_modifier_pct, source_kind, quest_id
      )
      select p_user_id, 'debuff', 'Cobwebs of Procrastination',
             '−10% XP on the next completion, the hour has passed.',
             -10, 'deadline_missed', v_quest.id
      where not exists (
        select 1 from public.modifiers
        where user_id = p_user_id and quest_id = v_quest.id
          and source_kind = 'deadline_missed' and consumed_at is null
      );
    end if;
  end loop;
end;
$$;
