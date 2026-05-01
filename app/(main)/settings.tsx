import { Pressable, Text, View } from 'react-native';

import { useAuth } from '../../lib/auth';

export default function Settings() {
  const { session, signOut } = useAuth();

  return (
    <View className="flex-1 bg-stone-950 px-6 pt-16">
      <Text className="mb-1 text-3xl text-stone-100">Settings</Text>
      <Text className="mb-8 text-stone-400">
        Phase 4.5 will populate notification, audio, and theme controls.
      </Text>

      {session?.user.email ? (
        <View className="mb-8">
          <Text className="mb-1 text-sm text-stone-500">Signed in as</Text>
          <Text className="text-stone-200">{session.user.email}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => signOut()}
        className="rounded-md border border-stone-700 bg-stone-900 px-4 py-3 active:bg-stone-800"
      >
        <Text className="text-center text-base text-stone-100">Sign out</Text>
      </Pressable>
    </View>
  );
}
