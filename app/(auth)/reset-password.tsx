// Set-new-password screen reached after the chronicler taps the reset
// link in the recovery email. AuthProvider catches PASSWORD_RECOVERY
// and useProtectedRoute pins them here until they submit a new password.

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { PasswordInput } from '../../components/password-input';
import { updatePassword } from '../../lib/account';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';

export default function ResetPassword() {
  const router = useRouter();
  const { clearPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const tooShort = password.length > 0 && password.length < 6;
  const mismatch = confirm.length > 0 && password !== confirm;
  const disabled = loading || password.length < 6 || password !== confirm;

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await updatePassword(password);
      // Clear the recovery flag so useProtectedRoute releases the user
      // back to normal session routing — they'll land on the next gate
      // (character creation or quest board, depending on their state).
      clearPasswordRecovery();
      // Belt-and-suspenders: explicitly push to the quest board. The
      // gate will redirect if the user actually needs onboarding.
      router.replace('/quest-board');
    } catch (e) {
      setError(errorMessage(e));
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 justify-center bg-stone-950 px-6">
      <Text className="mb-1 font-display text-3xl text-stone-100">Renew your seal</Text>
      <Text className="mb-8 font-body text-stone-400">
        The Archivist has accepted your request. Inscribe a new password to reclaim the Tome.
      </Text>

      <Text className="mb-2 font-body text-sm text-stone-300">New password</Text>
      <PasswordInput
        value={password}
        onChangeText={setPassword}
        autoComplete="new-password"
        editable={!loading}
        placeholder="At least 6 characters"
      />
      {tooShort ? (
        <Text className="-mt-3 mb-3 font-body text-sm text-amber-500">
          Must be at least 6 characters.
        </Text>
      ) : null}

      <Text className="mb-2 font-body text-sm text-stone-300">Confirm new password</Text>
      <PasswordInput
        value={confirm}
        onChangeText={setConfirm}
        autoComplete="new-password"
        editable={!loading}
        placeholder="Re-enter to confirm"
      />
      {mismatch ? (
        <Text className="-mt-3 mb-3 font-body text-sm text-red-400">Passwords don&apos;t match.</Text>
      ) : null}

      {error ? <Text className="mb-4 font-body text-sm text-red-400">{error}</Text> : null}

      <Pressable
        onPress={onSubmit}
        disabled={disabled}
        className={`rounded-md px-4 py-3 ${disabled ? 'bg-stone-800' : 'bg-amber-600 active:bg-amber-700'}`}
      >
        <Text className="text-center font-body-medium text-base text-stone-100">
          {loading ? 'Sealing the new password…' : 'Set new password'}
        </Text>
      </Pressable>
    </View>
  );
}
