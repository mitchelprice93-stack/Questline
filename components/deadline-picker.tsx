// Calendar + time picker for quest deadlines. Replaces the free-text
// deadline input which fought with chrono-node parsing edge cases. Trigger
// looks like the rest of the DropdownPicker triggers in the app. Tapping
// opens a Modal with: month/year header + chevron nav, a 7-column day grid,
// and below that an hour / minute / AM-PM row using DropdownPickers.
//
// Value is stored as an ISO timestamp (string) or null for no deadline.

import { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';

import { DropdownPicker, type DropdownOption } from './dropdown-picker';

interface Props {
  /** ISO timestamp or null for no deadline. */
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
}

const WEEKDAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const HOUR_OPTIONS_12: DropdownOption<string>[] = Array.from({ length: 12 }, (_, i) => {
  const h = i + 1;
  return { value: String(h), label: String(h) };
});

const MINUTE_OPTIONS: DropdownOption<string>[] = ['00', '15', '30', '45'].map((m) => ({
  value: m,
  label: m,
}));

const MERIDIEM_OPTIONS: DropdownOption<'AM' | 'PM'>[] = [
  { value: 'AM', label: 'AM' },
  { value: 'PM', label: 'PM' },
];

/** Convert a 12-hour clock (1-12 + AM/PM) into a 24-hour hour value. */
function to24Hour(h12: number, meridiem: 'AM' | 'PM'): number {
  if (meridiem === 'AM') return h12 === 12 ? 0 : h12;
  return h12 === 12 ? 12 : h12 + 12;
}

/** Decompose a Date into the editor's 12-hour state. */
function from24Hour(h24: number): { h12: number; meridiem: 'AM' | 'PM' } {
  const meridiem: 'AM' | 'PM' = h24 < 12 ? 'AM' : 'PM';
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return { h12, meridiem };
}

/** Snap a minute to the nearest 15-min option. */
function snapMinute(m: number): '00' | '15' | '30' | '45' {
  if (m < 8) return '00';
  if (m < 23) return '15';
  if (m < 38) return '30';
  if (m < 53) return '45';
  return '00';
}

/** Days in `month` of `year`. month is 0-indexed (Jan=0). */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** Format an ISO string for the trigger display. */
function triggerDisplay(iso: string | null): string {
  if (!iso) return 'No deadline';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return 'No deadline';
  const dateStr = d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dateStr} · ${timeStr}`;
}

export function DeadlinePicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);

  // Working state inside the modal. Initialized from `value` when the modal
  // opens so the picker always reflects current data on entry. Committed
  // only on tap of "Set deadline".
  const initial = value ? new Date(value) : null;
  const [year, setYear] = useState(() => (initial ?? new Date()).getFullYear());
  const [month, setMonth] = useState(() => (initial ?? new Date()).getMonth());
  const [day, setDay] = useState<number | null>(() => initial?.getDate() ?? null);
  const [hour, setHour] = useState<string>(() => {
    const h = initial ? from24Hour(initial.getHours()).h12 : 9;
    return String(h);
  });
  const [minute, setMinute] = useState<string>(() => {
    return initial ? snapMinute(initial.getMinutes()) : '00';
  });
  const [meridiem, setMeridiem] = useState<'AM' | 'PM'>(() => {
    return initial ? from24Hour(initial.getHours()).meridiem : 'AM';
  });

  // Re-seed the editor whenever the modal opens, so it reflects the latest
  // committed value rather than whatever was left from the previous session.
  useEffect(() => {
    if (!open) return;
    const seed = value ? new Date(value) : new Date();
    setYear(seed.getFullYear());
    setMonth(seed.getMonth());
    setDay(value ? seed.getDate() : null);
    const { h12, meridiem: m } = from24Hour(seed.getHours());
    setHour(String(h12));
    setMinute(snapMinute(seed.getMinutes()));
    setMeridiem(m);
  }, [open, value]);

  const prevMonth = () => {
    if (month === 0) {
      setMonth(11);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  };
  const nextMonth = () => {
    if (month === 11) {
      setMonth(0);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  };

  const onCommit = () => {
    if (day === null) {
      // No date picked yet, do nothing (the Set button should be disabled,
      // this is a belt-and-suspenders guard).
      return;
    }
    const h24 = to24Hour(parseInt(hour, 10), meridiem);
    const m = parseInt(minute, 10);
    const date = new Date(year, month, day, h24, m, 0, 0);
    onChange(date.toISOString());
    setOpen(false);
  };

  const onClear = () => {
    onChange(null);
    setOpen(false);
  };

  // Build the day grid: leading blanks for the offset of the 1st of the
  // month, then the days, padded to a multiple of 7.
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0=Sun
  const totalDays = daysInMonth(year, month);
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDayOfMonth; i++) cells.push(null);
  for (let d = 1; d <= totalDays; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <View className="mb-4">
      <Text className="mb-2 font-body text-xl text-stone-700">Deadline (optional)</Text>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={disabled}
        className="flex-row items-center justify-between rounded-md border border-stone-700 bg-amber-50/40 px-4 py-3 active:bg-amber-100/60"
      >
        <Text className="font-body text-xl text-stone-900">{triggerDisplay(value)}</Text>
        <Text className="font-body text-xl text-stone-600">▾</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable
          onPress={() => setOpen(false)}
          className="flex-1 items-center justify-center bg-stone-950/70 px-6"
        >
          {/* Inner Pressable swallows taps on the body */}
          <Pressable onPress={() => undefined} className="w-full max-w-md">
            <View className="rounded-md border border-amber-900 bg-amber-50 p-4">
              {/* Month/year header with nav */}
              <View className="mb-3 flex-row items-center justify-between">
                <Pressable
                  onPress={prevMonth}
                  className="rounded-md px-3 py-2 active:bg-amber-100"
                  accessibilityLabel="Previous month"
                >
                  <Text className="font-display text-2xl text-amber-800">‹</Text>
                </Pressable>
                <Text className="font-display text-xl text-stone-900">
                  {MONTH_NAMES[month]} {year}
                </Text>
                <Pressable
                  onPress={nextMonth}
                  className="rounded-md px-3 py-2 active:bg-amber-100"
                  accessibilityLabel="Next month"
                >
                  <Text className="font-display text-2xl text-amber-800">›</Text>
                </Pressable>
              </View>

              {/* Weekday header */}
              <View className="mb-1 flex-row">
                {WEEKDAY_HEADERS.map((h, i) => (
                  <View key={i} className="flex-1 items-center py-1">
                    <Text className="font-display text-xs uppercase tracking-widest text-stone-500">
                      {h}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Day grid */}
              <View className="mb-3 flex-row flex-wrap">
                {cells.map((cell, idx) => {
                  const selected = cell !== null && cell === day;
                  return (
                    <Pressable
                      key={idx}
                      onPress={() => {
                        if (cell !== null) setDay(cell);
                      }}
                      disabled={cell === null}
                      // 1/7 width per day so the row always holds exactly 7 cells.
                      className={`w-[14.2857%] items-center justify-center py-2 ${
                        selected ? 'rounded-md bg-amber-600' : ''
                      }`}
                    >
                      <Text
                        className={`font-body text-lg ${
                          selected ? 'font-body-medium text-amber-50' : 'text-stone-800'
                        } ${cell === null ? 'opacity-0' : ''}`}
                      >
                        {cell ?? '·'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Time row */}
              <Text className="mb-1 font-display text-xs uppercase tracking-widest text-stone-500">
                Time
              </Text>
              <View className="mb-3 flex-row gap-2">
                <View className="flex-1">
                  <DropdownPicker
                    label=""
                    value={hour}
                    onChange={setHour}
                    options={HOUR_OPTIONS_12}
                    showSelectedRightLabel={false}
                  />
                </View>
                <View className="flex-1">
                  <DropdownPicker
                    label=""
                    value={minute}
                    onChange={setMinute}
                    options={MINUTE_OPTIONS}
                    showSelectedRightLabel={false}
                  />
                </View>
                <View className="flex-1">
                  <DropdownPicker
                    label=""
                    value={meridiem}
                    onChange={setMeridiem}
                    options={MERIDIEM_OPTIONS}
                    showSelectedRightLabel={false}
                  />
                </View>
              </View>

              {/* Action row */}
              <View className="flex-row gap-2">
                <Pressable
                  onPress={onClear}
                  className="flex-1 rounded-md border border-stone-700 bg-amber-50/40 px-3 py-3 active:bg-amber-100"
                >
                  <Text className="text-center font-body text-lg text-stone-700">
                    Remove deadline
                  </Text>
                </Pressable>
                <Pressable
                  onPress={onCommit}
                  disabled={day === null}
                  className={`flex-1 rounded-md px-3 py-3 ${
                    day === null
                      ? 'bg-amber-100/40'
                      : 'bg-amber-600 active:bg-amber-700'
                  }`}
                >
                  <Text className="text-center font-body-medium text-lg text-stone-900">
                    Set deadline
                  </Text>
                </Pressable>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
