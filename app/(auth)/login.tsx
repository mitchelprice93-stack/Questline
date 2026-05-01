import { Link } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useAuth } from '../../lib/auth';

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    const result = await signIn(email.trim(), password);
    if (result.error) setError(result.error.message);
    setLoading(false);
  };

  const disabled = loading || email.trim().length === 0 || password.length === 0;

  return (
    <View className="flex-1 justify-center bg-stone-950 px-6">
      <Text className="mb-1 text-3xl text-stone-100">Welcome back</Text>
      <Text className="mb-8 text-stone-400">The Archivist remembers your name.</Text>

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
        autoComplete="current-password"
        className="mb-4 rounded-md border border-stone-700 bg-stone-900 px-4 py-3 text-stone-100"
        placeholderTextColor="#78716c"
        editable={!loading}
      />

      {error ? <Text className="mb-4 text-sm text-red-400">{error}</Text> : null}

      <Pressable
        onPress={onSubmit}
        disabled={disabled}
        className={`rounded-md px-4 py-3 ${disabled ? 'bg-stone-800' : 'bg-amber-600 active:bg-amber-700'}`}
      >
        <Text className="text-center text-base font-medium text-stone-100">
          {loading ? 'Signing in…' : 'Sign in'}
        </Text>
      </Pressable>

      <View className="mt-6 flex-row justify-center">
        <Text className="text-stone-400">New here? </Text>
        <Link href="/signup" className="text-amber-400">
          Forge your character
        </Link>
      </View>

      {/* Apple/Google Sign In intentionally deferred — needs Apple Developer
          enrollment + Google Cloud OAuth client setup; revisit before launch. */}
    </View>
  );
}
