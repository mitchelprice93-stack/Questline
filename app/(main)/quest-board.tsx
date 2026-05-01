import { Text, View } from 'react-native';

export default function QuestBoard() {
  return (
    <View className="flex-1 items-center justify-center bg-stone-950 px-6">
      <Text className="text-2xl text-stone-100">Quest Board</Text>
      <Text className="mt-2 text-stone-400">Phase 1.5 will list active quests here.</Text>
    </View>
  );
}
