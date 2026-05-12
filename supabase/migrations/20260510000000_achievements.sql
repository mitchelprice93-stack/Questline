-- v1.1 — Achievement system.
--
-- Two tables:
--   * achievements_earned   — append-only ledger of granted achievements.
--                             Templated achievements (per-faction, per-arc,
--                             per-streak-quest) live in metadata as JSONB.
--   * achievement_progress  — running counts for quantitative achievements
--                             (e.g. 3/5 dawn quests), so the UI can show
--                             "almost there" without re-querying source rows.
--
-- Granting is client-side (lib/engine/achievementTriggers.ts) per v1.1 spec —
-- the unique index below is the safety net against the offline-queue replay
-- path double-granting.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- achievements_earned
-- ---------------------------------------------------------------------------
create table public.achievements_earned (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_code text not null,
  -- NULL for one-shot achievements (first_blood, etc.).
  -- Non-null for templates: { "faction_id": "...", "faction_name": "..." } etc.
  metadata jsonb,
  earned_at timestamptz not null default now()
);

create index achievements_earned_user_idx
  on public.achievements_earned (user_id);
create index achievements_earned_user_code_idx
  on public.achievements_earned (user_id, achievement_code);

-- Uniqueness needs two partial indexes because Postgres treats NULL ≠ NULL.
-- One-shot rows (metadata IS NULL) collide on (user_id, code); template rows
-- (metadata IS NOT NULL) collide on (user_id, code, metadata).
create unique index achievements_earned_one_shot_uniq
  on public.achievements_earned (user_id, achievement_code)
  where metadata is null;
create unique index achievements_earned_template_uniq
  on public.achievements_earned (user_id, achievement_code, metadata)
  where metadata is not null;

alter table public.achievements_earned enable row level security;

create policy "Users read own earned achievements"
  on public.achievements_earned for select
  using (auth.uid() = user_id);

create policy "Users insert own earned achievements"
  on public.achievements_earned for insert
  with check (auth.uid() = user_id);

-- No update/delete policy — earning is one-way. Reset Character wipes via
-- the SECURITY DEFINER reset_character() RPC.

-- ---------------------------------------------------------------------------
-- achievement_progress
-- ---------------------------------------------------------------------------
create table public.achievement_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_code text not null,
  current_value int not null default 0 check (current_value >= 0),
  target_value int not null check (target_value > 0),
  last_updated timestamptz not null default now(),
  primary key (user_id, achievement_code)
);

create index achievement_progress_user_idx
  on public.achievement_progress (user_id);

alter table public.achievement_progress enable row level security;

create policy "Users access own progress"
  on public.achievement_progress for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- profiles.last_seen_at — drives the "Resurrected" achievement (login after
-- a 30-day absence). Updated by the client on every session start; nullable
-- so first-time signups don't trip the absence check.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists last_seen_at timestamptz;

-- ---------------------------------------------------------------------------
-- reset_character() — extend to clear achievement state alongside the rest
-- of the chronicle. Keeps the wipe consistent with the existing semantics
-- (auth account stays, everything else goes).
-- ---------------------------------------------------------------------------
create or replace function public.reset_character()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  delete from public.achievement_progress where user_id = v_user_id;
  delete from public.achievements_earned where user_id = v_user_id;
  delete from public.modifiers where user_id = v_user_id;
  delete from public.xp_log where user_id = v_user_id;
  delete from public.quests where user_id = v_user_id;
  delete from public.campaigns where user_id = v_user_id;
  delete from public.factions where user_id = v_user_id;

  update public.profiles
    set character_name = null,
        character_title = null,
        level = 1,
        total_xp = 0,
        difficulty = 'adept',
        last_rest_at = null,
        last_seen_at = null
    where id = v_user_id;
end;
$$;

revoke all on function public.reset_character() from public;
grant execute on function public.reset_character() to authenticated;
