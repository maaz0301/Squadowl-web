import { describe, expect, it } from 'vitest';
import { formatHeight, heightToText, isValidHeightText, parseHeightCm } from './height';

describe('parseHeightCm', () => {
  it('reads centimetres, with or without the unit', () => {
    expect(parseHeightCm('168')).toBe(168);
    expect(parseHeightCm('168 cm')).toBe(168);
    expect(parseHeightCm('172.5cm')).toBe(172.5);
  });

  it('reads feet and inches in the usual ways', () => {
    expect(parseHeightCm(`5'6"`)).toBe(167.6);
    expect(parseHeightCm('5 ft 6')).toBe(167.6);
    expect(parseHeightCm('5ft')).toBe(152.4);
    expect(parseHeightCm('5-6')).toBe(167.6);
  });

  it('reads inches, and treats a bare number under 100 as inches', () => {
    expect(parseHeightCm('66 in')).toBe(167.6);
    expect(parseHeightCm('66')).toBe(167.6);
  });

  it('returns null for empty or unreadable text', () => {
    expect(parseHeightCm('')).toBeNull();
    expect(parseHeightCm('tall')).toBeNull();
    expect(parseHeightCm(undefined)).toBeNull();
  });
});

describe('isValidHeightText', () => {
  it('accepts blank and believable heights, rejects the rest', () => {
    expect(isValidHeightText('')).toBe(true);
    expect(isValidHeightText('150')).toBe(true);
    expect(isValidHeightText('tall')).toBe(false);
    expect(isValidHeightText('900')).toBe(false);
    expect(isValidHeightText('5')).toBe(false);
  });
});

describe('formatHeight', () => {
  it('shows both units, and nothing when unknown', () => {
    expect(formatHeight(168)).toBe(`168 cm (5'6")`);
    expect(formatHeight(undefined)).toBe('');
    expect(heightToText(167.6)).toBe('167.6');
  });
});
