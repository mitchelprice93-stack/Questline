// Shared objectives editor used by both the new-quest review screen and the
// quest detail edit mode. Leading underscore keeps expo-router from treating
// this as a route.

import { Pressable, Text, TextInput, View } from 'react-native';

import type { QuestObjective } from '../../../lib/types/models';

interface Props {
  objectives: QuestObjective[];
  onChange: (next: QuestObjective[]) => void;
  disabled?: boolean;
}

export function ObjectivesEditor({ objectives, onChange, disabled }: Props) {
  const update = (idx: number, partial: Partial<QuestObjective>) => {
    onChange(objectives.map((o, i) => (i === idx ? { ...o, ...partial } : o)));
  };
  const remove = (idx: number) => {
    onChange(objectives.filter((_, i) => i !== idx));
  };
  const add = () => {
    onChange([...objectives, { text: '', completed: false }]);
  };

  return (
    <View>
      {objectives.map((obj, idx) => (
        <View key={idx} className="mb-2 flex-row items-center gap-2">
          <Pressable
            onPress={() => update(idx, { completed: !obj.completed })}
            disabled={disabled}
            className="rounded-md border border-stone-700 bg-stone-900 px-3 py-2 active:bg-stone-800"
          >
            <Text className="font-body text-stone-300">{obj.completed ? '☑' : '☐'}</Text>
          </Pressable>
          <TextInput
            value={obj.text}
            onChangeText={(text) => update(idx, { text })}
            placeholder="Step…"
            placeholderTextColor="#57534e"
            editable={!disabled}
            multiline
            className="flex-1 rounded-md border border-stone-700 bg-stone-900 px-3 py-2 font-body text-stone-100"
          />
          <Pressable
            onPress={() => remove(idx)}
            disabled={disabled}
            className="rounded-md border border-stone-800 bg-stone-900 px-3 py-2 active:bg-stone-800"
          >
            <Text className="font-body text-stone-400">×</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={add}
        disabled={disabled}
        className="mt-1 rounded-md border border-dashed border-stone-700 px-3 py-2 active:bg-stone-900"
      >
        <Text className="text-center font-body text-sm text-stone-400">+ Add objective</Text>
      </Pressable>
    </View>
  );
}
