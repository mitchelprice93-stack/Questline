// Faction picker for the new-quest review screen and the quest-detail
// edit form. Lets the user link a quest to one of their factions so
// completing it auto-increments the faction's reputation_count (the
// SQL trigger in 20260508000004 does the bumping).
//
// Hidden when the user has no factions. Leading underscore keeps
// expo-router from treating this as a route.

import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { listFactions } from '../../../lib/profile';
import type { Faction } from '../../../lib/types/models';

interface Props {
  /** Currently-selected faction id, or null for "no faction". */
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}

export function FactionPicker({ value, onChange, disabled }: Props) {
  const [factions, setFactions] = useState<Faction[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listFactions()
      .then((rows) => {
        if (!cancelled) setFactions(rows);
      })
      .catch(() => {
        if (!cancelled) setFactions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (factions === null) return null;
  if (factions.length === 0) return null;

  return (
    <View>
      <View className="flex-row flex-wrap gap-2">
        <Chip
          label="None"
          selected={value === null}
          onPress={() => onChange(null)}
          disabled={disabled}
        />
        {factions.map((f) => (
          <Chip
            key={f.id}
            label={f.name}
            selected={value === f.id}
            onPress={() => onChange(f.id)}
            disabled={disabled}
          />
        ))}
      </View>
      {value !== null ? (
        <Text className="mt-2 font-body text-sm text-stone-600">
          Completing this quest will add one tally to the faction's standing.
        </Text>
      ) : null}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`rounded-full border px-3 py-1.5 ${
        selected ? 'border-amber-500 bg-amber-600/20' : 'border-stone-700 bg-amber-50/40'
      }`}
    >
      <Text
        className={`font-body-medium text-base ${
          selected ? 'text-amber-800' : 'text-stone-700'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );
}
