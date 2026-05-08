// Inline editor for a quest's optional granted-buff. Used in both the
// new-quest review screen and the quest-detail edit form. Leading underscore
// keeps expo-router from treating this as a route.

import { Pressable, Text, TextInput, View } from 'react-native';

import { buffDurationDaysForTier, type QuestTier } from '../../../lib/engine/xp';
import type { GrantedBuffCondition } from '../../../lib/types/models';

export interface BuffDraft {
  enabled: boolean;
  name: string;
  description: string;
  pct: string; // string so the input is controlled even mid-typing
  condition: GrantedBuffCondition;
}

const CONDITIONS: { key: GrantedBuffCondition; label: string; help: string }[] = [
  { key: 'on_complete', label: 'On complete', help: 'Earned whenever the quest is finished.' },
  { key: 'on_time', label: 'Before deadline', help: 'Earned only if you finish before the deadline.' },
  {
    key: 'all_objectives',
    label: 'All objectives',
    help: 'Earned only if every objective box is checked.',
  },
];

export const emptyBuffDraft = (): BuffDraft => ({
  enabled: false,
  name: '',
  description: '',
  pct: '10',
  condition: 'on_complete',
});

export function buffDraftFromQuest(quest: {
  granted_buff_name: string | null;
  granted_buff_description: string | null;
  granted_buff_pct: number | null;
  granted_buff_condition: GrantedBuffCondition | null;
}): BuffDraft {
  if (!quest.granted_buff_name || quest.granted_buff_pct == null || !quest.granted_buff_condition) {
    return emptyBuffDraft();
  }
  return {
    enabled: true,
    name: quest.granted_buff_name,
    description: quest.granted_buff_description ?? '',
    pct: String(quest.granted_buff_pct),
    condition: quest.granted_buff_condition,
  };
}

/**
 * Returns the GrantedBuff payload (or null) suitable for createQuest /
 * updateQuest. Trims/validates the draft.
 */
export function buffDraftToPayload(draft: BuffDraft): {
  name: string;
  description: string | null;
  pct: number;
  condition: GrantedBuffCondition;
} | null {
  if (!draft.enabled) return null;
  const name = draft.name.trim();
  const pct = parseInt(draft.pct, 10);
  if (!name || isNaN(pct) || pct <= 0) return null;
  return {
    name,
    description: draft.description.trim() || null,
    pct,
    condition: draft.condition,
  };
}

interface Props {
  draft: BuffDraft;
  onChange: (next: BuffDraft) => void;
  /** Tier of the parent quest. Drives the lifetime line shown to the user
   *  so they understand the "harder quest = longer buff" trade-off. */
  questTier: QuestTier;
  disabled?: boolean;
}

export function BuffEditor({ draft, onChange, questTier, disabled }: Props) {
  const update = (partial: Partial<BuffDraft>) => onChange({ ...draft, ...partial });

  const conditionHelp = CONDITIONS.find((c) => c.key === draft.condition)?.help ?? '';
  const durationDays = buffDurationDaysForTier(questTier);

  if (!draft.enabled) {
    return (
      <Pressable
        onPress={() => update({ enabled: true })}
        disabled={disabled}
        className="rounded-md border border-dashed border-amber-700/50 px-4 py-3 active:bg-amber-50/40"
      >
        <Text className="text-center font-body text-base text-amber-800">
          + Attach a granted buff
        </Text>
        <Text className="mt-0.5 text-center font-body text-sm text-stone-500">
          A reward beyond XP — applies to the next completion if its condition is met.
        </Text>
      </Pressable>
    );
  }

  return (
    <View className="rounded-md border border-amber-900/50 bg-amber-50/40 p-3">
      <View className="mb-2 flex-row items-baseline justify-between">
        <Text className="font-display text-sm uppercase tracking-widest text-amber-800">
          Granted buff
        </Text>
        <Pressable
          onPress={() => update({ enabled: false })}
          disabled={disabled}
          className="active:opacity-60"
        >
          <Text className="font-body text-sm text-stone-700">Remove</Text>
        </Pressable>
      </View>

      <Text className="mb-1 font-display text-xs uppercase tracking-widest text-stone-500">
        Name
      </Text>
      <TextInput
        value={draft.name}
        onChangeText={(name) => update({ name })}
        placeholder="e.g. Sage's Insight"
        placeholderTextColor="#57534e"
        editable={!disabled}
        className="mb-3 rounded-md border border-stone-700 bg-amber-50/60 px-3 py-2 font-body text-stone-900"
      />

      <Text className="mb-1 font-display text-xs uppercase tracking-widest text-stone-500">
        Effect description
      </Text>
      <TextInput
        value={draft.description}
        onChangeText={(description) => update({ description })}
        placeholder="What does the chronicler feel after the deed?"
        placeholderTextColor="#57534e"
        editable={!disabled}
        multiline
        className="mb-3 rounded-md border border-stone-700 bg-amber-50/60 px-3 py-2 font-body text-stone-900"
      />

      <Text className="mb-1 font-display text-xs uppercase tracking-widest text-stone-500">
        XP bonus on next completion (%)
      </Text>
      <TextInput
        value={draft.pct}
        onChangeText={(pct) => update({ pct: pct.replace(/[^0-9]/g, '').slice(0, 3) })}
        keyboardType="number-pad"
        editable={!disabled}
        className="mb-3 rounded-md border border-stone-700 bg-amber-50/60 px-3 py-2 font-body text-stone-900"
      />

      <Text className="mb-1 font-display text-xs uppercase tracking-widest text-stone-500">
        Condition
      </Text>
      <View className="mb-1 flex-row flex-wrap gap-2">
        {CONDITIONS.map((c) => {
          const selected = draft.condition === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => update({ condition: c.key })}
              disabled={disabled}
              className={`rounded-full border px-3 py-1.5 ${
                selected ? 'border-amber-500 bg-amber-600/20' : 'border-stone-700 bg-amber-50/60'
              }`}
            >
              <Text
                className={`font-body-medium text-sm ${
                  selected ? 'text-amber-800' : 'text-stone-700'
                }`}
              >
                {c.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text className="mb-2 font-body text-sm text-stone-500">{conditionHelp}</Text>
      <Text className="font-body text-sm text-amber-800/80">
        Lasts {durationDays} day{durationDays === 1 ? '' : 's'} once earned ·
        scales with quest tier ({questTier}).
      </Text>
    </View>
  );
}
