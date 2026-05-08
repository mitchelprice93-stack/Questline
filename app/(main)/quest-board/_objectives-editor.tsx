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
            className="rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 active:bg-amber-100/60"
          >
            <Text className="font-body text-stone-700">{obj.completed ? '☑' : '☐'}</Text>
          </Pressable>
          <TextInput
            value={obj.text}
            onChangeText={(text) => update(idx, { text })}
            placeholder="Step…"
            placeholderTextColor="#57534e"
            editable={!disabled}
            multiline
            className="flex-1 rounded-md border border-stone-700 bg-amber-50/40 px-3 py-2 font-body text-stone-900"
          />
          <Pressable
            onPress={() => remove(idx)}
            disabled={disabled}
            className="rounded-md border border-stone-800 bg-amber-50/40 px-3 py-2 active:bg-amber-100/60"
          >
            <Text className="font-body text-stone-700">×</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={add}
        disabled={disabled}
        className="mt-1 rounded-md border border-dashed border-stone-700 px-3 py-2 active:bg-amber-50/40"
      >
        <Text className="text-center font-body text-base text-stone-700">+ Add objective</Text>
      </Pressable>
    </View>
  );
}
