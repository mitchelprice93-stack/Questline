-- Phase 5 follow-up — reset_character() RPC.
--
-- Wipes the chronicle for the calling user without touching the auth
-- account: deletes their factions, campaigns, quests, modifiers, and
-- xp_log entries, then resets their profile to the pre-creation defaults
-- (character_name / character_title NULL, level 1, total_xp 0, difficulty
-- 'adept', last_rest_at NULL). The user is bounced back through
-- character creation on next launch because apply_character_creation
-- only runs when character_name is NULL.
--
-- ai_call_log is intentionally NOT cleared — keeping the lifetime
-- character_creation count means a reset chronicler can still only
-- forge one chronicle per day's cost ceiling. push_tokens stays so
-- the same device keeps receiving notifications post-reset.
--
-- SECURITY DEFINER so the function can DELETE rows without each table
-- needing a "user can wipe own row" policy. The auth check inside is
-- the only authorization gate.

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
        last_rest_at = null
    where id = v_user_id;
end;
$$;

revoke all on function public.reset_character() from public;
grant execute on function public.reset_character() to authenticated;
