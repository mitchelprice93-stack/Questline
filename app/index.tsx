import { Redirect } from 'expo-router';
import { Text, View } from 'react-native';

import { useAuth } from '../lib/auth';

export default function Index() {
  const { session, profile, loading, profileLoading } = useAuth();

  if (loading || (session && profileLoading)) {
    return (
      <View className="flex-1 items-center justify-center bg-stone-950">
        <Text className="text-stone-400">Loading…</Text>
      </View>
    );
  }
  if (!session) return <Redirect href="/login" />;
  if (!profile?.character_name) return <Redirect href="/character-creation" />;
  return <Redirect href="/quest-board" />;
}
