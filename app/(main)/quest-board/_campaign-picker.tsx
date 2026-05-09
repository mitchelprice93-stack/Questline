// Campaign picker for the new-quest review screen and the quest-detail
// edit form. Lets the user link a quest to one of their active campaigns
// so completing it auto-bumps that campaign's progress (the SQL trigger
// in 20260508000004 does the bumping).
//
// Hidden when the user has no active campaigns. Leading underscore keeps
// expo-router from treating this as a route.

import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { listCampaigns } from '../../../lib/profile';
import type { Campaign } from '../../../lib/types/models';

interface Props {
  /** Currently-selected campaign id, or null for "no campaign". */
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}

export function CampaignPicker({ value, onChange, disabled }: Props) {
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listCampaigns('active')
      .then((rows) => {
        if (!cancelled) setCampaigns(rows);
      })
      .catch(() => {
        if (!cancelled) setCampaigns([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Don't render anything until we know whether there are any campaigns,
  // and don't render at all if the user has none — picker would just be
  // a "None" toggle, which is the default state anyway.
  if (campaigns === null) return null;
  if (campaigns.length === 0) return null;

  return (
    <View>
      <View className="flex-row flex-wrap gap-2">
        <Chip
          label="None"
          selected={value === null}
          onPress={() => onChange(null)}
          disabled={disabled}
        />
        {campaigns.map((c) => (
          <Chip
            key={c.id}
            label={c.arc_name}
            selected={value === c.id}
            onPress={() => onChange(c.id)}
            disabled={disabled}
          />
        ))}
      </View>
      {value !== null ? (
        <Text className="mt-2 font-body text-sm text-stone-600">
          Completing this quest will advance the campaign by a tier-scaled amount
          (trivial 2% → legendary 40%).
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
