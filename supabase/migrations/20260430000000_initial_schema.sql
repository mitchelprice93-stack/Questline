-- Questline initial schema (Phase 1.2).
-- Mirrors QUESTLINE_PROJECT.md "DATABASE SCHEMA" section. Adds:
--   * Row-Level Security on every public table
--   * CHECK constraints on enum-like text columns
--   * FK indexes
--   * auth.users -> profiles auto-insert trigger (Supabase canonical pattern)
--
-- Apply with:  supabase db push        (after `supabase link --project-ref ...`)
-- Or manually: paste this file into the Supabase SQL editor.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  character_name text,
  character_title text,
  level int not null default 1 check (level between 1 and 50),
  total_xp bigint not null default 0 check (total_xp >= 0),
  difficulty text not null default 'adept'
    check (difficulty in ('apprentice', 'adept', 'master', 'legendary')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "Users insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- factions
-- ---------------------------------------------------------------------------
create table public.factions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  real_world_domain text not null,
  created_at timestamptz not null default now()
);

create index factions_user_id_idx on public.factions (user_id);

alter table public.factions enable row level security;

create policy "Users access own factions"
  on public.factions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- campaigns
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  faction_id uuid references public.factions (id) on delete set null,
  arc_name text not null,
  real_world_goal text not null,
  progress_pct int not null default 0 check (progress_pct between 0 and 100),
  status text not null default 'active'
    check (status in ('active', 'completed', 'abandoned')),
  created_at timestamptz not null default now()
);

create index campaigns_user_id_idx on public.campaigns (user_id);
create index campaigns_faction_id_idx on public.campaigns (faction_id);

alter table public.campaigns enable row level security;

create policy "Users access own campaigns"
  on public.campaigns for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- quests
-- ---------------------------------------------------------------------------
create table public.quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  faction_id uuid references public.factions (id) on delete set null,
  campaign_id uuid references public.campaigns (id) on delete set null,
  title text not null,
  description text,
  objectives jsonb not null default '[]'::jsonb,
  tier text not null
    check (tier in ('trivial', 'minor', 'standard', 'major', 'legendary')),
  classification text not null
    check (classification in ('daily', 'side', 'main', 'legendary')),
  xp_reward int not null check (xp_reward >= 0),
  status text not null default 'active'
    check (status in ('active', 'completed', 'abandoned')),
  recurrence text check (recurrence in ('daily', 'weekly')),
  streak_count int not null default 0 check (streak_count >= 0),
  deadline timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index quests_user_id_idx on public.quests (user_id);
create index quests_faction_id_idx on public.quests (faction_id);
create index quests_campaign_id_idx on public.quests (campaign_id);
create index quests_status_idx on public.quests (status);

alter table public.quests enable row level security;

create policy "Users access own quests"
  on public.quests for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- xp_log  (audit trail; never deleted)
-- ---------------------------------------------------------------------------
create table public.xp_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  quest_id uuid references public.quests (id) on delete set null,
  xp_change int not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index xp_log_user_id_idx on public.xp_log (user_id);
create index xp_log_quest_id_idx on public.xp_log (quest_id);

alter table public.xp_log enable row level security;

-- xp_log is append-only from the user's perspective; deletions only via service role.
create policy "Users read own xp log"
  on public.xp_log for select
  using (auth.uid() = user_id);

create policy "Users insert own xp log"
  on public.xp_log for insert
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- modifiers  (buffs and debuffs)
-- ---------------------------------------------------------------------------
create table public.modifiers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null check (type in ('buff', 'debuff')),
  name text not null,
  effect_description text,
  xp_modifier_pct int not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index modifiers_user_id_idx on public.modifiers (user_id);
create index modifiers_expires_at_idx on public.modifiers (expires_at);

alter table public.modifiers enable row level security;

create policy "Users access own modifiers"
  on public.modifiers for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- ai_call_log  (cost monitoring; written by the edge-function proxy)
-- ---------------------------------------------------------------------------
create table public.ai_call_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  model text not null,
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10, 6),
  endpoint text,
  created_at timestamptz not null default now()
);

create index ai_call_log_user_id_idx on public.ai_call_log (user_id);
create index ai_call_log_created_at_idx on public.ai_call_log (created_at desc);

alter table public.ai_call_log enable row level security;

-- Users see their own usage for transparency; writes happen via service role
-- from the claude-proxy edge function (Phase 2.1) and bypass RLS.
create policy "Users read own ai call log"
  on public.ai_call_log for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- subscriptions  (RevenueCat sync target; webhook updates via service role)
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  tier text not null default 'free' check (tier in ('free', 'hero')),
  status text check (status in ('active', 'trial', 'expired', 'cancelled')),
  expires_at timestamptz,
  rc_customer_id text,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

create policy "Users read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- New-user trigger: auto-create a profiles row when auth.users gets one.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
