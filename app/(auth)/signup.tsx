import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '../../lib/auth';

export default function Signup() {
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState(false);

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    const result = await signUp(email.trim(), password);
    if (result.error) {
      setError(result.error.message);
    } else {
      // If Supabase has email confirmation on (default), the user lands here
      // and must click the email link before signIn works. If confirmation
      // is off, onAuthStateChange will fire and the protected-route effect
      // will redirect them onward — this screen state is fine either way.
      setPendingConfirmation(true);
    }
    setLoading(false);
  };

  if (pendingConfirmation) {
    return (
      <View className="flex-1 justify-center bg-stone-950 px-6">
        <Text className="mb-2 text-3xl text-stone-100">Check your inbox</Text>
        <Text className="mb-6 text-stone-400">
          The Archivist has sent a sealed message to{' '}
          <Text className="text-stone-200">{email.trim()}</Text>. Confirm your address, then return
          and sign in.
        </Text>
        <Link href="/login" className="text-amber-400">
          Back to sign in
        </Link>
      </View>
    );
  }

  const disabled = loading || email.trim().length === 0 || password.length < 6;

  return (
    <View className="flex-1 justify-center bg-stone-950 px-6">
      <Text className="mb-1 text-3xl text-stone-100">Forge your character</Text>
      <Text className="mb-8 text-stone-400">
        A new chronicle begins. Email and password are all the Archivist needs.
      </Text>

      <Text className="mb-2 text-sm text-stone-300">Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        className="mb-4 rounded-md border border-stone-700 bg-stone-900 px-4 py-3 text-stone-100"
        placeholderTextColor="#78716c"
        editable={!loading}
      />

      <Text className="mb-2 text-sm text-stone-300">Password</Text>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="new-password"
        className="mb-1 rounded-md border border-stone-700 bg-stone-900 px-4 py-3 text-stone-100"
        placeholderTextColor="#78716c"
        editable={!loading}
      />
      <Text className="mb-4 text-xs text-stone-500">At least 6 characters.</Text>

      {error ? <Text className="mb-4 text-sm text-red-400">{error}</Text> : null}

      <Pressable
        onPress={onSubmit}
        disabled={disabled}
        className={`rounded-md px-4 py-3 ${disabled ? 'bg-stone-800' : 'bg-amber-600 active:bg-amber-700'}`}
      >
        <Text className="text-center text-base font-medium text-stone-100">
          {loading ? 'Inscribing…' : 'Create account'}
        </Text>
      </Pressable>

      <View className="mt-6 flex-row justify-center">
        <Text className="text-stone-400">Already inscribed? </Text>
        <Link href="/login" className="text-amber-400">
          Sign in
        </Link>
      </View>
    </View>
  );
}
