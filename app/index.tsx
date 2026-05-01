import { Redirect } from 'expo-router';
import { Text, View } from 'react-native';

import { useAuth } from '../lib/auth';

export default function Index() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-950">
        <Text className="text-stone-400">Loading…</Text>
      </View>
    );
  }

  return session ? <Redirect href="/quest-board" /> : <Redirect href="/login" />;
}
