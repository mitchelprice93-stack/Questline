import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { PasswordInput } from '../../components/password-input';
import { requestPasswordReset } from '../../lib/account';
import { useAuth } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    const result = await signIn(email.trim(), password);
    if (result.error) setError(result.error.message);
    setLoading(false);
  };

  const onForgotPassword = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('Enter your email above first, then tap "Forgot password?".');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await requestPasswordReset(trimmed);
      setResetSent(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const disabled = loading || email.trim().length === 0 || password.length === 0;

  return (
    <View className="flex-1 justify-center bg-stone-950 px-6">
      <Text className="mb-1 font-display text-3xl text-stone-100">Welcome back</Text>
      <Text className="mb-8 font-body text-stone-400">The Archivist remembers your name.</Text>

      <Text className="mb-2 font-body text-sm text-stone-300">Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        className="mb-4 rounded-md border border-stone-700 bg-stone-900 px-4 py-3 font-body text-stone-100"
        placeholderTextColor="#78716c"
        editable={!loading}
      />

      <Text className="mb-2 font-body text-sm text-stone-300">Password</Text>
      <PasswordInput
        value={password}
        onChangeText={setPassword}
        autoComplete="current-password"
        editable={!loading}
      />

      {error ? <Text className="mb-4 font-body text-sm text-red-400">{error}</Text> : null}
      {resetSent ? (
        <Text className="mb-4 font-body text-sm text-amber-400">
          The Archivist has dispatched a sealed scroll to {email.trim()}. Look for it in your inbox
          (and check the spam pile, ravens sometimes wander).
        </Text>
      ) : null}

      <Pressable
        onPress={onSubmit}
        disabled={disabled}
        className={`rounded-md px-4 py-3 ${disabled ? 'bg-stone-800' : 'bg-amber-600 active:bg-amber-700'}`}
      >
        <Text className="text-center font-body-medium text-base text-stone-100">
          {loading ? 'Signing in…' : 'Sign in'}
        </Text>
      </Pressable>

      <Pressable
        onPress={onForgotPassword}
        disabled={loading}
        className="mt-3 self-center active:opacity-60"
      >
        <Text className="font-body text-sm text-amber-400">Forgot your password?</Text>
      </Pressable>

      <View className="mt-6 flex-row justify-center">
        <Text className="font-body text-stone-400">New here? </Text>
        <Link href="/signup" className="font-body-medium text-amber-400">
          Forge your character
        </Link>
      </View>

      {/* Apple/Google Sign In intentionally deferred, needs Apple Developer
          enrollment + Google Cloud OAuth client setup; revisit before launch. */}
    </View>
  );
}
