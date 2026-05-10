// Account management — change email, change password.
//
// Both flows go through Supabase Auth. The user receives a confirmation
// email at the new address (or a reset link, for password) and the change
// only takes effect once they click through. We don't auto-update local
// state — the next session refresh will pick up the new email.

import { asError } from './errors';
import { supabase } from './supabase';

/**
 * Send a password-reset email. The user clicks the link, sets a new
 * password, and is signed back in. Cleaner than asking for the new
 * password inline because we don't have to handle the form state.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) throw asError(error);
}

/**
 * Initiate an email change. Supabase sends a confirmation link to the new
 * address; the change applies once that link is clicked.
 */
export async function requestEmailChange(newEmail: string): Promise<void> {
  const trimmed = newEmail.trim();
  if (!trimmed || !trimmed.includes('@')) {
    throw new Error('Please enter a valid email address.');
  }
  const { error } = await supabase.auth.updateUser({ email: trimmed });
  if (error) throw asError(error);
}

/**
 * Permanently delete the calling user's account. Calls the delete-account
 * edge function which uses the service-role key to invoke
 * auth.admin.deleteUser(). All dependent rows (profile, quests, modifiers,
 * xp_log, etc.) cascade automatically via FK constraints.
 *
 * After deletion the local session is no longer valid; the caller should
 * sign out to clear local state.
 */
export async function deleteAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke<{
    success?: boolean;
    error?: string;
  }>('delete-account', {
    method: 'POST',
  });
  if (error) throw asError(error);
  if (data?.error) throw new Error(data.error);
}

/**
 * Wipe the calling user's chronicle without touching the auth account.
 * Deletes all factions, campaigns, quests, modifiers, and xp_log entries
 * for the user, then resets the profile to pre-character-creation
 * defaults (character_name = NULL, level 1, total_xp 0, difficulty
 * 'adept'). Auth session, push token, and ai_call_log history are kept.
 *
 * After this resolves, the caller should clear any local AsyncStorage
 * caches (offline quest cache, tutorial flag, etc.) and route back
 * through onboarding so apply_character_creation runs again.
 */
export async function resetCharacter(): Promise<void> {
  const { error } = await supabase.rpc('reset_character');
  if (error) throw asError(error);
}
