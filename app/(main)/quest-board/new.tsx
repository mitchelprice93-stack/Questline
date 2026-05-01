import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { xpForTier, type QuestTier } from '../../../lib/engine/xp';
import { generateQuest, type GeneratedQuest } from '../../../lib/quest-generation';
import { createQuest } from '../../../lib/quests';
import type { QuestClassification } from '../../../lib/types/models';

const TIERS: QuestTier[] = ['trivial', 'minor', 'standard', 'major', 'legendary'];
const CLASSIFICATIONS: QuestClassification[] = ['daily', 'side', 'main', 'legendary'];

type Phase = 'input' | 'loading' | 'review';

export default function NewQuest() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('input');
  const [input, setInput] = useState('');
  const [draft, setDraft] = useState<GeneratedQuest | null>(null);
  const [tier, setTier] = useState<QuestTier>('standard');
  const [classification, setClassification] = useState<QuestClassification>('side');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onForge = async () => {
    if (!input.trim()) return;
    setPhase('loading');
    setError(null);
    try {
      const generated = await generateQuest(input);
      setDraft(generated);
      setTitle(generated.title);
      setDescription(generated.description);
      setTier(generated.suggested_tier);
      setClassification(generated.classification);
      setPhase('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('input');
    }
  };

  const onRegenerate = () => {
    setDraft(null);
    onForge();
  };

  const onDiscard = () => {
    setDraft(null);
    setPhase('input');
  };

  const onSave = async () => {
    if (!draft) return;
    setSubmitting(true);
    setError(null);
    try {
      await createQuest({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        tier,
        classification,
        deadline: null,
        objectives: draft.objectives,
      });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  if (phase === 'loading') {
    return (
      <View className="flex-1 items-center justify-center bg-stone-950 px-6">
        <ActivityIndicator color="#f59e0b" size="large" />
        <Text className="mt-6 text-xl text-stone-100">The Archivist considers your request…</Text>
      </View>
    );
  }

  if (phase === 'input') {
    return (
      <ScrollView className="flex-1 bg-stone-950" contentContainerClassName="px-6 pt-16 pb-12">
        <Text className="mb-1 text-3xl text-stone-100">New endeavor</Text>
        <Text className="mb-6 text-stone-400">
          Tell the Archivist what you need to do, in plain language. They will forge it into a quest
          for the Tome.
        </Text>

        <Text className="mb-2 text-sm text-stone-300">What&apos;s the endeavor?</Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          multiline
          placeholder="e.g., Finish the thermo lab report by Friday"
          placeholderTextColor="#57534e"
          textAlignVertical="top"
          className="mb-4 min-h-[140px] rounded-md border border-stone-700 bg-stone-900 px-4 py-3 text-stone-100"
        />

        {error ? <Text className="mb-4 text-sm text-red-400">{error}</Text> : null}

        <Pressable
          onPress={onForge}
          disabled={!input.trim()}
          className={`rounded-md px-4 py-3 ${input.trim() ? 'bg-amber-600 active:bg-amber-700' : 'bg-stone-800'}`}
        >
          <Text className="text-center text-base font-medium text-stone-100">
            Forge with the Archivist
          </Text>
        </Pressable>
      </ScrollView>
    );
  }

  // Review phase — draft is set.
  if (!draft) return null;

  return (
    <ScrollView className="flex-1 bg-stone-950" contentContainerClassName="px-6 pt-16 pb-12">
      <Text className="mb-1 text-xs uppercase tracking-widest text-amber-400">
        {draft.fromFallback ? 'Templated draft' : 'The Archivist offers'}
      </Text>
      <Text className="mb-6 text-3xl text-stone-100">Review the quest</Text>

      {draft.tactical_warnings.length > 0 ? (
        <View className="mb-6 rounded-md border border-amber-900/40 bg-amber-950/20 p-4">
          <Text className="mb-1 text-xs uppercase tracking-widest text-amber-500">
            Tactical warnings
          </Text>
          {draft.tactical_warnings.map((w, i) => (
            <Text key={i} className="text-sm text-stone-300">
              · {w}
            </Text>
          ))}
        </View>
      ) : null}

      <Text className="mb-2 text-sm text-stone-300">Title</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        editable={!submitting}
        className="mb-4 rounded-md border border-stone-700 bg-stone-900 px-4 py-3 text-stone-100"
      />

      <Text className="mb-2 text-sm text-stone-300">Description</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        multiline
        editable={!submitting}
        textAlignVertical="top"
        className="mb-4 min-h-[112px] rounded-md border border-stone-700 bg-stone-900 px-4 py-3 text-stone-100"
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

      {draft.objectives.length > 0 ? (
        <View className="mb-6">
          <Text className="mb-2 text-sm text-stone-300">Objectives</Text>
          <View className="rounded-md border border-stone-800 bg-stone-900 p-4">
            {draft.objectives.map((obj, i) => (
              <Text key={i} className="text-sm text-stone-300">
                ☐ {obj.text}
              </Text>
            ))}
          </View>
          <Text className="mt-1 text-xs text-stone-500">
            Edit individual objectives later from the quest detail screen.
          </Text>
        </View>
      ) : null}

      {error ? <Text className="mb-4 text-sm text-red-400">{error}</Text> : null}

      <View className="mb-3 flex-row gap-3">
        <Pressable
          onPress={onSave}
          disabled={submitting || !title.trim()}
          className={`flex-1 rounded-md px-4 py-3 ${submitting || !title.trim() ? 'bg-stone-800' : 'bg-amber-600 active:bg-amber-700'}`}
        >
          <Text className="text-center text-base font-medium text-stone-100">
            {submitting ? 'Saving…' : 'Save quest'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onRegenerate}
          disabled={submitting}
          className="rounded-md border border-stone-700 bg-stone-900 px-4 py-3 active:bg-stone-800"
        >
          <Text className="text-center text-stone-300">Regenerate</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={onDiscard}
        disabled={submitting}
        className="rounded-md px-4 py-3 active:bg-stone-900"
      >
        <Text className="text-center text-sm text-stone-500">Discard and start over</Text>
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
