// Faction picker for the new-quest review screen and the quest-detail
// edit form. Lets the user link a quest to one of their factions so
// completing it auto-increments the faction's reputation_count (the
// SQL trigger in 20260508000004 does the bumping).
//
// Hidden when the user has no factions — leading underscore keeps
// expo-router from treating this as a route.
//
// UI delegates to the shared <DropdownPicker> so it matches Tier /
// Classification / Recurrence on the same form. The wrapper maps the
// dropdown's string value to/from null (no-faction) at the boundary.

import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { DropdownPicker } from '../../../components/dropdown-picker';
import { listFactions } from '../../../lib/profile';
import type { Faction } from '../../../lib/types/models';

// Sentinel for "no faction selected" inside the DropdownPicker (which
// requires a string-typed value). Translated to/from `null` at the
// component boundary so callers can keep using nullable ids.
const NONE = '__none__';

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

  const options = [
    { value: NONE, label: 'None', description: 'No faction tally for this quest.' },
    ...factions.map((f) => ({
      value: f.id,
      label: f.name,
      description: f.real_world_domain,
      rightLabel: f.reputation_title,
    })),
  ];

  return (
    <View>
      <DropdownPicker
        label="Faction (optional)"
        value={value ?? NONE}
        onChange={(v) => onChange(v === NONE ? null : v)}
        disabled={disabled}
        headerInMenu="Choose the faction"
        options={options}
        showSelectedRightLabel={false}
      />
      {value !== null ? (
        <Text className="-mt-2 mb-4 px-1 font-body text-sm italic text-stone-500">
          Completing this quest will add one tally to the faction's standing.
        </Text>
      ) : null}
    </View>
  );
}
