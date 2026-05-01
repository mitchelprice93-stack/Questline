import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { xpForTier, type QuestTier } from '../../../lib/engine/xp';
import { createQuest } from '../../../lib/quests';
import type { QuestClassification } from '../../../lib/types/models';

const TIERS: QuestTier[] = ['trivial', 'minor', 'standard', 'major', 'legendary'];
const CLASSIFICATIONS: QuestClassification[] = ['daily', 'side', 'main', 'legendary'];

export default function NewQuest() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tier, setTier] = useState<QuestTier>('standard');
  const [classification, setClassification] = useState<QuestClassification>('side');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await createQuest({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        tier,
        classification,
        deadline: deadline.trim() ? deadline.trim() : null,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  const disabled = submitting || title.trim().length === 0;

  return (
    <ScrollView className="flex-1 bg-stone-950" contentContainerClassName="px-6 pt-16 pb-12">
      <Text className="mb-1 text-3xl text-stone-100">New Quest</Text>
      <Text className="mb-8 text-stone-400">A new entry for your chronicle.</Text>

      <Text className="mb-2 text-sm text-stone-300">Title</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        className="mb-4 rounded-md border border-stone-700 bg-stone-900 px-4 py-3 text-stone-100"
        placeholderTextColor="#78716c"
        editable={!submitting}
      />

      <Text className="mb-2 text-sm text-stone-300">Description (optional)</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        multiline
        numberOfLines={4}
        className="mb-4 min-h-[96px] rounded-md border border-stone-700 bg-stone-900 px-4 py-3 text-stone-100"
        placeholderTextColor="#78716c"
        textAlignVertical="top"
        editable={!submitting}
      />

      <Text className="mb-2 text-sm text-stone-300">Tier · grants {xpForTier(tier)} XP</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {TIERS.map((t) => (
          <Chip key={t} label={t} selected={tier === t} onPress={() => setTier(t)} />
        ))}
      </View>

      <Text className="mb-2 text-sm text-stone-300">Classification</Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {CLASSIFICATIONS.map((c) => (
          <Chip
            key={c}
            label={c}
            selected={classification === c}
            onPress={() => setClassification(c)}
          />
        ))}
      </View>

      <Text className="mb-2 text-sm text-stone-300">Deadline (optional, ISO date)</Text>
      <TextInput
        value={deadline}
        onChangeText={setDeadline}
        autoCapitalize="none"
        placeholder="2026-05-15T18:00:00Z"
        placeholderTextColor="#57534e"
        className="mb-1 rounded-md border border-stone-700 bg-stone-900 px-4 py-3 text-stone-100"
        editable={!submitting}
      />
      <Text className="mb-6 text-xs text-stone-500">
        A proper date picker lands later — for now paste an ISO 8601 string or leave blank.
      </Text>

      {error ? <Text className="mb-4 text-sm text-red-400">{error}</Text> : null}

      <Pressable
        onPress={onSubmit}
        disabled={disabled}
        className={`rounded-md px-4 py-3 ${disabled ? 'bg-stone-800' : 'bg-amber-600 active:bg-amber-700'}`}
      >
        <Text className="text-center text-base font-medium text-stone-100">
          {submitting ? 'Inscribing…' : 'Forge quest'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`rounded-full border px-3 py-1.5 ${selected ? 'border-amber-500 bg-amber-600/20' : 'border-stone-700 bg-stone-900'}`}
    >
      <Text className={`text-sm capitalize ${selected ? 'text-amber-300' : 'text-stone-300'}`}>
        {label}
      </Text>
    </Pressable>
  );
}
