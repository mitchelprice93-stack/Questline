import { isCompletedThisPeriod, recurrenceStatusLabel } from './dates';

describe('isCompletedThisPeriod', () => {
  test('returns false for one-shot quests regardless of completion', () => {
    const now = new Date('2026-05-03T12:00:00Z');
    expect(isCompletedThisPeriod(null, '2026-05-03T11:59:00Z', now)).toBe(false);
  });

  test('returns false when never completed', () => {
    const now = new Date('2026-05-03T12:00:00Z');
    expect(isCompletedThisPeriod('daily', null, now)).toBe(false);
    expect(isCompletedThisPeriod('weekly', null, now)).toBe(false);
  });

  test('daily — same UTC day counts as in-period', () => {
    const now = new Date('2026-05-03T23:30:00Z');
    expect(isCompletedThisPeriod('daily', '2026-05-03T00:01:00Z', now)).toBe(true);
    expect(isCompletedThisPeriod('daily', '2026-05-03T22:00:00Z', now)).toBe(true);
  });

  test('daily — different UTC day is out of period', () => {
    const now = new Date('2026-05-03T01:00:00Z');
    // Yesterday UTC
    expect(isCompletedThisPeriod('daily', '2026-05-02T23:00:00Z', now)).toBe(false);
    // Tomorrow UTC (shouldn't normally happen but test the boundary)
    expect(isCompletedThisPeriod('daily', '2026-05-04T01:00:00Z', now)).toBe(false);
  });

  test('weekly — same ISO week (Monday-anchored) counts as in-period', () => {
    // 2026-05-04 is a Monday; week runs Mon May 4 → Sun May 10 UTC.
    const now = new Date('2026-05-07T12:00:00Z'); // Thu in that week
    expect(isCompletedThisPeriod('weekly', '2026-05-04T00:00:00Z', now)).toBe(true); // Mon
    expect(isCompletedThisPeriod('weekly', '2026-05-10T23:00:00Z', now)).toBe(true); // Sun
  });

  test('weekly — adjacent week is out of period', () => {
    const now = new Date('2026-05-07T12:00:00Z');
    // Sun Apr 26 → Sat May 2 ... wait, ISO week of May 4 is Mon-Sun. Previous
    // week ended Sun May 3. May 3 should be out of period.
    expect(isCompletedThisPeriod('weekly', '2026-05-03T23:59:00Z', now)).toBe(false); // prev week's Sun
    expect(isCompletedThisPeriod('weekly', '2026-05-11T00:00:00Z', now)).toBe(false); // next week's Mon
  });

  test('returns false for unparseable timestamps', () => {
    const now = new Date('2026-05-03T12:00:00Z');
    expect(isCompletedThisPeriod('daily', 'not a date', now)).toBe(false);
  });
});

describe('recurrenceStatusLabel', () => {
  test('returns null when not in cooldown', () => {
    const now = new Date('2026-05-03T12:00:00Z');
    expect(recurrenceStatusLabel('daily', null, now)).toBeNull();
    expect(recurrenceStatusLabel('weekly', null, now)).toBeNull();
    expect(recurrenceStatusLabel(null, '2026-05-03T11:00:00Z', now)).toBeNull();
  });

  test('returns "Done today" for daily in cooldown', () => {
    const now = new Date('2026-05-03T12:00:00Z');
    expect(recurrenceStatusLabel('daily', '2026-05-03T08:00:00Z', now)).toBe('Done today');
  });

  test('returns "Done this week" for weekly in cooldown', () => {
    const now = new Date('2026-05-07T12:00:00Z');
    expect(recurrenceStatusLabel('weekly', '2026-05-04T08:00:00Z', now)).toBe('Done this week');
  });
});
