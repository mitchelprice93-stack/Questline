-- Campaign achievements (a.k.a. "Personal" achievements).
--
-- One row per campaign-the-chronicler-finished. The Archivist (claude-proxy)
-- generates a cleverly worded title plus a one-sentence description when a
-- campaign's progress_pct reaches 100, and the client writes the row.
--
-- Separate from achievements_earned because:
--   * Title/description are open-ended, AI-generated text rather than
--     references to entries in the predefined achievements registry.
--   * The unique constraint is (user_id, campaign_id), the per-campaign
--     achievement is one-and-done.
--
-- earned_at is the timestamp shown to the user; for live completions it's
-- now(), for the backfill path it's set explicitly to the campaign's
-- most-recent quest-completion timestamp so the gallery dates line up
-- with when the work actually finished.

set check_function_bodies = off;

create table public.campaign_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- One achievement per campaign; if the campaign is deleted, the trophy
  -- goes with it (matches user intent: deleting a chronicled arc wipes
  -- it everywhere it appears, including the gallery).
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  title text not null check (length(title) between 1 and 80),
  description text not null check (length(description) between 1 and 240),
  earned_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (campaign_id)
);

create index campaign_achievements_user_idx
  on public.campaign_achievements (user_id, earned_at desc);

alter table public.campaign_achievements enable row level security;

create policy "Users read own campaign achievements"
  on public.campaign_achievements for select
  using (auth.uid() = user_id);

create policy "Users insert own campaign achievements"
  on public.campaign_achievements for insert
  with check (auth.uid() = user_id);

-- No update/delete policy; the cascade on campaign deletion is the only
-- intended removal path. (Reset Character below wipes via the
-- SECURITY DEFINER reset_character() RPC.)

-- ---------------------------------------------------------------------------
-- reset_character(), extend to also wipe campaign_achievements alongside
-- the rest of the chronicle.
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

  delete from public.campaign_achievements where user_id = v_user_id;
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
