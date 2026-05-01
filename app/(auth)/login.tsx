import { Link } from 'expo-router';
import { Text, View } from 'react-native';

export default function Login() {
  return (
    <View className="flex-1 items-center justify-center bg-stone-950 px-6">
      <Text className="text-2xl text-stone-100">Login</Text>
      <Text className="mt-2 text-stone-400">Phase 1.3 will wire this up.</Text>
      <Link href="/signup" className="mt-6 text-amber-400">
        Go to signup
      </Link>
      <Link href="/cinematic" className="mt-2 text-amber-400">
        Go to onboarding
      </Link>
      <Link href="/quest-board" className="mt-2 text-amber-400">
        Go to quest board
      </Link>
    </View>
  );
}
