import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { useAuth } from '../../lib/auth';

export default function Settings() {
  const { session, signOut } = useAuth();
  const router = useRouter();

  return (
    <View className="flex-1 bg-stone-950 px-6 pt-16">
      <Text className="mb-1 font-display text-3xl text-stone-100">Settings</Text>
      <Text className="mb-8 font-body text-stone-400">
        Phase 4.5 will populate notification, audio, and theme controls.
      </Text>

      {session?.user.email ? (
        <View className="mb-8">
          <Text className="mb-1 font-display text-xs uppercase tracking-widest text-stone-500">
            Signed in as
          </Text>
          <Text className="font-body text-stone-200">{session.user.email}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => router.push('/cinematic')}
        className="mb-3 rounded-md border border-stone-700 bg-stone-900 px-4 py-3 active:bg-stone-800"
      >
        <Text className="text-center font-body text-base text-stone-200">
          Replay opening cinematic
        </Text>
      </Pressable>

      <Pressable
        onPress={() => signOut()}
        className="rounded-md border border-stone-700 bg-stone-900 px-4 py-3 active:bg-stone-800"
      >
        <Text className="text-center font-body text-base text-stone-100">Sign out</Text>
      </Pressable>
    </View>
  );
}
