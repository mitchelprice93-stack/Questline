// Campaign picker for the new-quest review screen and the quest-detail
// edit form. Lets the user link a quest to one of their active campaigns
// so completing it auto-bumps that campaign's progress (the SQL trigger
// in 20260508000004 does the bumping).
//
// Hidden when the user has no active campaigns, leading underscore
// keeps expo-router from treating this as a route.
//
// UI delegates to the shared <DropdownPicker> so it matches Tier /
// Classification / Recurrence / Faction on the same form. The wrapper
// maps the dropdown's string value to/from null (no-campaign) at the
// component boundary.

import { useEffect, useState } from 'react';

import { DropdownPicker } from '../../../components/dropdown-picker';
import { listCampaigns } from '../../../lib/profile';
import type { Campaign } from '../../../lib/types/models';

const NONE = '__none__';

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

  if (campaigns === null) return null;
  if (campaigns.length === 0) return null;

  const options = [
    { value: NONE, label: 'None', description: 'No campaign linked.' },
    ...campaigns.map((c) => ({
      value: c.id,
      label: c.arc_name,
      description: c.real_world_goal,
      rightLabel: `${c.progress_pct}%`,
    })),
  ];

  // The contribution % input lives in the parent (next to the campaign
  // picker), so the picker itself just describes the link relationship.
  return (
    <DropdownPicker
      label="Campaign (optional)"
      value={value ?? NONE}
      onChange={(v) => onChange(v === NONE ? null : v)}
      disabled={disabled}
      headerInMenu="Choose the campaign"
      options={options}
      showSelectedRightLabel={false}
    />
  );
}
