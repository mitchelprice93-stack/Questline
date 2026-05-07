import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { parseDeadline } from '../../../lib/dates';
import { xpForTier, type QuestTier } from '../../../lib/engine/xp';
import { generateQuest, type GeneratedQuest } from '../../../lib/quest-generation';
import { createQuest } from '../../../lib/quests';
import type {
  QuestClassification,
  QuestObjective,
  QuestRecurrence,
} from '../../../lib/types/models';
import {
  BuffEditor,
  buffDraftToPayload,
  emptyBuffDraft,
  type BuffDraft,
} from './_buff-editor';
import { ObjectivesEditor } from './_objectives-editor';

const TIERS: QuestTier[] = ['trivial', 'minor', 'standard', 'major', 'legendary'];
const CLASSIFICATIONS: QuestClassification[] = ['daily', 'side', 'main', 'legendary'];
type RecurrenceChoice = 'none' | 'daily' | 'weekly';
const RECURRENCES: RecurrenceChoice[] = ['none', 'daily', 'weekly'];

function recurrenceForDb(choice: RecurrenceChoice): QuestRecurrence {
  return choice === 'none' ? null : choice;
}

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
  const [objectives, setObjectives] = useState<QuestObjective[]>([]);
  const [deadlineRaw, setDeadlineRaw] = useState('');
  const [recurrence, setRecurrence] = useState<RecurrenceChoice>('none');
  const [buff, setBuff] = useState<BuffDraft>(emptyBuffDraft());
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
      setObjectives(generated.objectives);
      // Prefill the buff editor from the AI's design — user can tweak or
      // remove on review.
      setBuff({
        enabled: true,
        name: generated.granted_buff.name,
        description: generated.granted_buff.description,
        pct: String(generated.granted_buff.pct),
        condition: generated.granted_buff.condition,
      });
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
    let deadlineIso: string | null = null;
    if (deadlineRaw.trim()) {
      const parsed = parseDeadline(deadlineRaw);
      if (!parsed) {
        setError(
          `Couldn't read "${deadlineRaw.trim()}" as a date. Try something like "May 15, 2026", "5/15/26", or "next Friday".`,
        );
        return;
      }
      deadlineIso = parsed.toISOString();
    }
    setSubmitting(true);
    setError(null);
    try {
      await createQuest({
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        tier,
        classification,
        deadline: deadlineIso,
        recurrence: recurrenceForDb(recurrence),
        grantedBuff: buffDraftToPayload(buff),
        objectives: objectives
          .map((o) => ({ ...o, text: o.text.trim() }))
          .filter((o) => o.text.length > 0),
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
        <Text className="mt-6 font-display text-xl text-stone-100">
          The Archivist considers your request…
        </Text>
      </View>
    );
  }

  if (phase === 'input') {
    return (
      <ScrollView className="flex-1 bg-stone-950" contentContainerClassName="px-6 pt-16 pb-12">
        <Text className="mb-1 font-display text-3xl text-stone-100">New endeavor</Text>
        <Text className="mb-6 font-body text-stone-400">
          Tell the Archivist what you need to do, in plain language. They will forge it into a quest
          for the Tome.
        </Text>

        <Text className="mb-2 font-body text-sm text-stone-300">What&apos;s the endeavor?</Text>
        <TextInput
          value={input}
          onChangeText={setInput}
          multiline
          placeholder="e.g., Finish the thermo lab report by Friday"
          placeholderTextColor="#57534e"
          textAlignVertical="top"
          className="mb-4 min-h-[140px] rounded-md border border-stone-700 bg-stone-900 px-4 py-3 font-body text-stone-100"
        />

        {error ? <Text className="mb-4 font-body text-sm text-red-400">{error}</Text> : null}

        <Pressable
          onPress={onForge}
          disabled={!input.trim()}
          className={`rounded-md px-4 py-3 ${input.trim() ? 'bg-amber-600 active:bg-amber-700' : 'bg-stone-800'}`}
        >
          <Text className="text-center font-display text-base text-stone-100">
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
      <Text className="mb-1 font-display text-xs uppercase tracking-widest text-amber-400">
        {draft.fromFallback ? 'Templated draft' : 'The Archivist offers'}
      </Text>
      <Text className="mb-6 font-display text-3xl text-stone-100">Review the quest</Text>

      {draft.tactical_warnings.length > 0 ? (
        <View className="mb-6 rounded-md border border-amber-900/40 bg-amber-950/20 p-4">
          <Text className="mb-1 font-display text-xs uppercase tracking-widest text-amber-500">
            Tactical warnings
          </Text>
          {draft.tactical_warnings.map((w, i) => (
            <Text key={i} className="font-body text-sm text-stone-300">
              · {w}
            </Text>
          ))}
        </View>
      ) : null}

      <Text className="mb-2 font-body text-sm text-stone-300">Title</Text>
      <TextInput
        value={title}
        onChangeText={setTitle}
        editable={!submitting}
        className="mb-4 rounded-md border border-stone-700 bg-stone-900 px-4 py-3 font-body text-stone-100"
      />

      <Text className="mb-2 font-body text-sm text-stone-300">Description</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        multiline
        editable={!submitting}
        textAlignVertical="top"
        className="mb-4 min-h-[112px] rounded-md border border-stone-700 bg-stone-900 px-4 py-3 font-body text-stone-100"
      />

      <Text className="mb-2 font-body text-sm text-stone-300">
        Tier · grants {xpForTier(tier)} XP
      </Text>
      <View className="mb-4 flex-row flex-wrap gap-2">
        {TIERS.map((t) => (
          <Chip key={t} label={t} selected={tier === t} onPress={() => setTier(t)} />
        ))}
      </View>

      <Text className="mb-2 font-body text-sm text-stone-300">Classification</Text>
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

      <Text className="mb-2 font-body text-sm text-stone-300">Recurrence</Text>
      <View className="mb-1 flex-row flex-wrap gap-2">
        {RECURRENCES.map((r) => (
          <Chip key={r} label={r} selected={recurrence === r} onPress={() => setRecurrence(r)} />
        ))}
      </View>
      <Text className="mb-4 font-body text-xs text-stone-500">
        {recurrence === 'none'
          ? 'A one-time quest. Completes once and goes to the log.'
          : recurrence === 'daily'
            ? 'Resets each day. Completing it on consecutive days builds a streak.'
            : 'Resets each week. Completing it on consecutive weeks builds a streak.'}
      </Text>

      <View className="mb-6">
        <Text className="mb-2 font-body text-sm text-stone-300">Objectives</Text>
        <ObjectivesEditor objectives={objectives} onChange={setObjectives} disabled={submitting} />
      </View>

      <Text className="mb-2 font-body text-sm text-stone-300">Granted buff (optional)</Text>
      <View className="mb-6">
        <BuffEditor draft={buff} onChange={setBuff} questTier={tier} disabled={submitting} />
      </View>

      <Text className="mb-2 font-body text-sm text-stone-300">Deadline (optional)</Text>
      <TextInput
        value={deadlineRaw}
        onChangeText={setDeadlineRaw}
        autoCapitalize="none"
        placeholder="e.g., May 15, 2026 · 5/15/26 · next Friday"
        placeholderTextColor="#57534e"
        className="mb-1 rounded-md border border-stone-700 bg-stone-900 px-4 py-3 font-body text-stone-100"
        editable={!submitting}
      />
      <Text className="mb-6 font-body text-xs text-stone-500">
        Plain language is fine — the Tome reads dates loosely.
      </Text>

      {error ? <Text className="mb-4 font-body text-sm text-red-400">{error}</Text> : null}

      <View className="mb-3 flex-row gap-3">
        <Pressable
          onPress={onSave}
          disabled={submitting || !title.trim()}
          className={`flex-1 rounded-md px-4 py-3 ${submitting || !title.trim() ? 'bg-stone-800' : 'bg-amber-600 active:bg-amber-700'}`}
        >
          <Text className="text-center font-display text-base text-stone-100">
            {submitting ? 'Saving…' : 'Save quest'}
          </Text>
        </Pressable>
        <Pressable
          onPress={onRegenerate}
          disabled={submitting}
          className="rounded-md border border-stone-700 bg-stone-900 px-4 py-3 active:bg-stone-800"
        >
          <Text className="text-center font-body text-stone-300">Regenerate</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={onDiscard}
        disabled={submitting}
        className="rounded-md px-4 py-3 active:bg-stone-900"
      >
        <Text className="text-center font-body text-sm text-stone-500">Discard and start over</Text>
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
      <Text
        className={`font-body-medium text-sm capitalize ${selected ? 'text-amber-300' : 'text-stone-300'}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
