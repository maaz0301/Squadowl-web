import { describe, expect, it } from 'vitest';

import { MAX_RECURRING_EVENTS, expandEventForms, expandRecurrence, weekdayOf } from './recurrence';

describe('expandRecurrence', () => {
  it('returns just the start date when there is no repeat', () => {
    expect(expandRecurrence('2026-10-06', undefined, undefined)).toEqual(['2026-10-06']);
    expect(expandRecurrence('2026-10-06', [], '2026-11-01')).toEqual(['2026-10-06']);
    expect(expandRecurrence('2026-10-06', [2], undefined)).toEqual(['2026-10-06']);
  });

  it('lists every chosen weekday through the end date, inclusive', () => {
    // 2026-10-06 is a Tuesday. Tuesdays and Thursdays through Oct 15.
    expect(weekdayOf('2026-10-06')).toBe(2);
    expect(expandRecurrence('2026-10-06', [2, 4], '2026-10-15')).toEqual([
      '2026-10-06',
      '2026-10-08',
      '2026-10-13',
      '2026-10-15',
    ]);
  });

  it('always includes the start date, even when its weekday was not ticked', () => {
    expect(expandRecurrence('2026-10-06', [4], '2026-10-15')).toEqual(['2026-10-06', '2026-10-08', '2026-10-15']);
  });

  it('crosses month and year ends and daylight saving changes without skipping a day', () => {
    expect(expandRecurrence('2026-12-28', [1], '2027-01-12')).toEqual(['2026-12-28', '2027-01-04', '2027-01-11']);
    // US clocks go back on 2026-11-01; the Monday after is still the 2nd.
    expect(expandRecurrence('2026-10-26', [1], '2026-11-09')).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
  });

  it('ignores an end date before the start', () => {
    expect(expandRecurrence('2026-10-06', [2], '2026-09-01')).toEqual(['2026-10-06']);
  });

  it('caps the number of events so a mistyped year cannot create thousands', () => {
    const dates = expandRecurrence('2026-10-06', [0, 1, 2, 3, 4, 5, 6], '2036-10-06');
    expect(dates).toHaveLength(MAX_RECURRING_EVENTS);
  });
});

describe('expandEventForms', () => {
  it('returns the form unchanged (minus repeat fields) when it does not repeat', () => {
    const forms = expandEventForms({ date: '2026-10-06', title: 'Practice' });
    expect(forms).toEqual([{ date: '2026-10-06', title: 'Practice' }]);
  });

  it('makes one form per date and keeps a multi-day event the same length', () => {
    const forms = expandEventForms({
      date: '2026-10-06',
      endDate: '2026-10-08',
      title: 'Camp',
      repeatWeekdays: [2],
      repeatUntil: '2026-10-20',
    });
    expect(forms.map((f) => [f.date, f.endDate])).toEqual([
      ['2026-10-06', '2026-10-08'],
      ['2026-10-13', '2026-10-15'],
      ['2026-10-20', '2026-10-22'],
    ]);
    expect(forms.every((f) => !('repeatWeekdays' in f) && !('repeatUntil' in f))).toBe(true);
  });
});
