// Shared day pickers for weekly and monthly quest recurrence. Used by both
// the new-quest review screen and the quest detail edit form. Leading
// underscore keeps expo-router from treating this as a route.
//
// Semantics:
//   - Weekly: pick zero or more weekdays. Empty = "once a week, any day"
//     (legacy behavior). One or more selected = each day is its own due
//     instance ("habit-tracker" mode).
//   - Monthly: same pattern with days-of-month (1..31).
//
// Day index follows JS Date.getDay (0=Sunday..6=Saturday).

import { Pressable, Text, View } from 'react-native';

const WEEKDAYS: { day: number; short: string }[] = [
  { day: 0, short: 'S' },
  { day: 1, short: 'M' },
  { day: 2, short: 'T' },
  { day: 3, short: 'W' },
  { day: 4, short: 'T' },
  { day: 5, short: 'F' },
  { day: 6, short: 'S' },
];

interface WeekdayProps {
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}

export function WeekdayChips({ value, onChange, disabled }: WeekdayProps) {
  const toggle = (d: number) => {
    onChange(value.includes(d) ? value.filter((v) => v !== d) : [...value, d].sort());
  };
  return (
    <View className="mb-4 rounded-md border border-amber-900/40 bg-amber-50/40 p-4">
      <Text className="mb-2 font-body text-base text-stone-600">
        Which days of the week? Leave empty for once a week, any day.
      </Text>
      <View className="flex-row gap-2">
        {WEEKDAYS.map((d) => {
          const selected = value.includes(d.day);
          return (
            <Pressable
              key={d.day}
              onPress={() => toggle(d.day)}
              disabled={disabled}
              className={`h-10 w-10 items-center justify-center rounded-full border ${
                selected ? 'border-amber-500 bg-amber-600/20' : 'border-stone-700 bg-amber-50/40'
              }`}
            >
              <Text
                className={`font-body-medium text-lg ${selected ? 'text-amber-800' : 'text-stone-700'}`}
              >
                {d.short}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

interface MonthDayProps {
  value: number[];
  onChange: (next: number[]) => void;
  disabled?: boolean;
}

export function MonthDayChips({ value, onChange, disabled }: MonthDayProps) {
  const days = Array.from({ length: 31 }, (_, i) => i + 1);
  const toggle = (d: number) => {
    onChange(value.includes(d) ? value.filter((v) => v !== d) : [...value, d].sort((a, b) => a - b));
  };
  return (
    <View className="mb-4 rounded-md border border-amber-900/40 bg-amber-50/40 p-4">
      <Text className="mb-2 font-body text-base text-stone-600">
        Which days of the month? Leave empty for once a month, any day.
      </Text>
      <View className="flex-row flex-wrap gap-1.5">
        {days.map((d) => {
          const selected = value.includes(d);
          return (
            <Pressable
              key={d}
              onPress={() => toggle(d)}
              disabled={disabled}
              className={`h-9 w-9 items-center justify-center rounded-md border ${
                selected ? 'border-amber-500 bg-amber-600/20' : 'border-stone-700 bg-amber-50/40'
              }`}
            >
              <Text
                className={`font-body-medium text-base ${selected ? 'text-amber-800' : 'text-stone-700'}`}
              >
                {d}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {value.some((d) => d > 28) ? (
        <Text className="mt-2 font-body text-sm italic text-stone-500">
          Days 29-31 are skipped in months that lack them (e.g. February).
        </Text>
      ) : null}
    </View>
  );
}
