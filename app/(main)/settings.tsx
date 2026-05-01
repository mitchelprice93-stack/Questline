import { Text, View } from 'react-native';

export default function Settings() {
  return (
    <View className="flex-1 items-center justify-center bg-stone-950 px-6">
      <Text className="text-2xl text-stone-100">Settings</Text>
      <Text className="mt-2 text-stone-400">
        Phase 4.5 will populate notification, audio, and theme controls.
      </Text>
    </View>
  );
}
