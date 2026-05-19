-- Phase 5.x, per-day recurrence pinning.
--
-- Lets a Weekly quest be due on a specific subset of weekdays (e.g.
-- Mon/Wed/Fri) and a Monthly quest be due on specific days of the month
-- (e.g. 1st and 15th). Each selected day is its own due instance, so a
-- weekly quest with three days picked produces three completable instances
-- per week rather than one.
--
-- Storage:
--   recurrence_weekdays   smallint[]  0-6 (0=Sunday, JS Date.getDay convention),
--                                     only set when recurrence='weekly'
--   recurrence_month_days smallint[]  1-31, only set when recurrence='monthly'
--
-- When the array is null on a weekly/monthly quest, behavior is unchanged
-- (one period = one due instance). This keeps every existing quest working
-- without backfill.

alter table public.quests
  add column if not exists recurrence_weekdays smallint[],
  add column if not exists recurrence_month_days smallint[];

-- weekdays only valid when recurrence='weekly', all entries 0..6, no dupes
alter table public.quests
  drop constraint if exists quests_recurrence_weekdays_check;

alter table public.quests
  add constraint quests_recurrence_weekdays_check
    check (
      recurrence_weekdays is null
      or (
        recurrence = 'weekly'
        and array_length(recurrence_weekdays, 1) >= 1
        and array_length(recurrence_weekdays, 1) <= 7
        and recurrence_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
      )
    );

-- month_days only valid when recurrence='monthly', all entries 1..31, no dupes
alter table public.quests
  drop constraint if exists quests_recurrence_month_days_check;

alter table public.quests
  add constraint quests_recurrence_month_days_check
    check (
      recurrence_month_days is null
      or (
        recurrence = 'monthly'
        and array_length(recurrence_month_days, 1) >= 1
        and array_length(recurrence_month_days, 1) <= 31
        and recurrence_month_days <@ array[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31]::smallint[]
      )
    );
