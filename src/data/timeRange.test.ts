import { describe, expect, it } from 'vitest';
import { CreateAssessmentFormSchema, CreateEventFormSchema } from './types';
import { END_BEFORE_START_MESSAGE, isEndAfterStart } from './timeRange';

describe('isEndAfterStart', () => {
  it('accepts an end later than the start', () => expect(isEndAfterStart('15:00', '16:30')).toBe(true));
  it('blocks an earlier end', () => expect(isEndAfterStart('15:00', '13:00')).toBe(false));
  it('blocks an equal end', () => expect(isEndAfterStart('15:00', '15:00')).toBe(false));
  it('accepts one minute later', () => expect(isEndAfterStart('09:00', '09:01')).toBe(true));
  it('blocks a midnight end after a late start', () => expect(isEndAfterStart('23:00', '00:00')).toBe(false));
  it('has nothing to compare when either is blank or unreadable', () => {
    expect(isEndAfterStart('', '10:00')).toBe(true);
    expect(isEndAfterStart('10:00', '')).toBe(true);
    expect(isEndAfterStart(undefined, undefined)).toBe(true);
    expect(isEndAfterStart('abc', '10:00')).toBe(true);
  });
  it('reads a single-digit hour', () => expect(isEndAfterStart('9:00', '10:00')).toBe(true));
});

describe('form schemas', () => {
  const event = (o: object) => CreateEventFormSchema.safeParse({ type: 'Event', title: 'x', date: '2026-09-25', ...o });
  it('reports the end time on the endTime field', () => {
    const r = event({ startTime: '15:00', endTime: '13:00' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => [i.path.join('.'), i.message])).toEqual([['endTime', END_BEFORE_START_MESSAGE]]);
  });
  it('blocks equal times, allows valid, one-sided and blank', () => {
    expect(event({ startTime: '15:00', endTime: '15:00' }).success).toBe(false);
    expect(event({ startTime: '15:00', endTime: '16:00' }).success).toBe(true);
    expect(event({ startTime: '15:00' }).success).toBe(true);
    expect(event({ startTime: '15:00', endTime: '' }).success).toBe(true);
  });
  it('keeps the existing end-date rule', () => {
    const r = event({ endDate: '2026-09-20' });
    expect(r.success).toBe(false);
  });
  it('applies to New Evaluation too', () => {
    const base = { name: 'Volleyball', sport: 'Hockey', eventType: 'Tryout' };
    expect(CreateAssessmentFormSchema.safeParse({ ...base, startTime: '15:00', endTime: '13:00' }).success).toBe(false);
    expect(CreateAssessmentFormSchema.safeParse({ ...base, startTime: '15:00', endTime: '17:00' }).success).toBe(true);
    expect(CreateAssessmentFormSchema.safeParse(base).success).toBe(true);
  });
});
