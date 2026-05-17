// Generic dropdown picker used across quest forms (Tier, Classification,
// Recurrence on both new.tsx and [id].tsx). Trigger styling matches the
// surrounding form inputs (font-body, stone-900) so it sits naturally
// alongside TextInputs. Options can carry a description + right-aligned
// metadata label, both shown inside the modal but not on the trigger.
//
// Trigger optionally shows the selected option's rightLabel inline, so
// the chronicler sees value + meta (e.g. "Standard · 1000 XP") without
// opening the menu.

import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Short italic body text shown below the label inside the menu. */
  description?: string;
  /** Right-aligned metadata shown inside the menu and optionally inline
   *  on the trigger (e.g. tier XP value, plan price). */
  rightLabel?: string;
}

interface Props<T extends string> {
  /** Field label rendered above the trigger. */
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: DropdownOption<T>[];
  disabled?: boolean;
  /** Caption above the option list inside the menu. */
  headerInMenu?: string;
  /** Italic caption below the option list inside the menu (good for
   *  "coming soon" hints, scaling rules, etc.). */
  footerInMenu?: string;
  /** When true, the selected option's rightLabel renders inline next to
   *  the trigger value (e.g. "Standard · 1000 XP"). Default true. */
  showSelectedRightLabel?: boolean;
}

export function DropdownPicker<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled,
  headerInMenu,
  footerInMenu,
  showSelectedRightLabel = true,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const triggerLabel = selected?.label ?? String(value);

  return (
    <View className="mb-4">
      <Text className="mb-2 font-body text-xl text-stone-700">{label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        className="flex-row items-center justify-between rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
      >
        <View className="flex-1 flex-row items-baseline">
          <Text className="font-body text-xl capitalize text-stone-900">{triggerLabel}</Text>
          {showSelectedRightLabel && selected?.rightLabel ? (
            <Text className="ml-2 font-body text-base text-stone-500">
              · {selected.rightLabel}
            </Text>
          ) : null}
        </View>
        <Text className="font-body text-xl text-stone-600">▾</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          onPress={() => setOpen(false)}
          className="flex-1 items-center justify-center bg-stone-950/70 px-6"
        >
          <View className="w-full max-w-md rounded-md border border-amber-900 bg-amber-50 p-2">
            {headerInMenu ? (
              <Text className="mb-2 px-2 pt-2 font-display text-base uppercase tracking-widest text-stone-500">
                {headerInMenu}
              </Text>
            ) : null}
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    setOpen(false);
                    if (!isSelected) onChange(opt.value);
                  }}
                  className={`rounded-md px-4 py-3 ${
                    isSelected ? 'bg-amber-900/30' : 'active:bg-amber-100/80'
                  }`}
                >
                  <View className="flex-row items-center justify-between">
                    <Text
                      className={`font-body-medium text-xl capitalize ${
                        isSelected ? 'text-amber-800' : 'text-stone-700'
                      }`}
                    >
                      {opt.label}
                    </Text>
                    {opt.rightLabel ? (
                      <Text
                        className={`font-body text-base ${
                          isSelected ? 'text-amber-800' : 'text-stone-500'
                        }`}
                      >
                        {opt.rightLabel}
                      </Text>
                    ) : null}
                  </View>
                  {opt.description ? (
                    <Text
                      className={`mt-0.5 font-body text-sm italic ${
                        isSelected ? 'text-amber-800' : 'text-stone-500'
                      }`}
                    >
                      {opt.description}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
            {footerInMenu ? (
              <Text className="mt-2 px-2 pb-2 font-body text-sm italic text-stone-500">
                {footerInMenu}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
