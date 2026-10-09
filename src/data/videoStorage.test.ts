import { describe, expect, it } from 'vitest';
import {
  BYTES_PER_GB,
  VIDEO_STORAGE_PLANS,
  formatBytes,
  formatPlanPrice,
  friendlyVideoError,
  isStorageFullMessage,
  isVideoStorageTier,
  storageFraction,
  storageLevel,
  storageMeterLabel,
} from './videoStorage';

describe('video storage plans', () => {
  it('sells 1, 5 and 20 GB at $15, $25 and $40 a year', () => {
    expect(VIDEO_STORAGE_PLANS.map((p) => [p.gb, p.priceCents])).toEqual([
      [1, 1500],
      [5, 2500],
      [20, 4000],
    ]);
    expect(formatPlanPrice(VIDEO_STORAGE_PLANS[1])).toBe('$25/year');
  });

  it('is only for Coach+ and Club', () => {
    expect(isVideoStorageTier('coach_plus')).toBe(true);
    expect(isVideoStorageTier('club')).toBe(true);
    expect(isVideoStorageTier('coach')).toBe(false);
    expect(isVideoStorageTier('free')).toBe(false);
    expect(isVideoStorageTier(undefined)).toBe(false);
  });
});

describe('storage meter', () => {
  const quota = 5 * BYTES_PER_GB;
  it('is ok below 80%, orange from 80%, red when full', () => {
    expect(storageLevel(0, quota)).toBe('ok');
    expect(storageLevel(quota * 0.79, quota)).toBe('ok');
    expect(storageLevel(quota * 0.8, quota)).toBe('warn');
    expect(storageLevel(quota * 0.99, quota)).toBe('warn');
    expect(storageLevel(quota, quota)).toBe('full');
    expect(storageLevel(quota + 1, quota)).toBe('full');
  });
  it('counts no quota as full and clamps the bar', () => {
    expect(storageLevel(0, 0)).toBe('full');
    expect(storageFraction(10, 0)).toBe(0);
    expect(storageFraction(quota * 2, quota)).toBe(1);
    expect(storageFraction(quota / 2, quota)).toBe(0.5);
  });
  it('labels usage like 2.3 GB / 5 GB used', () => {
    expect(storageMeterLabel(2.3 * BYTES_PER_GB, quota)).toBe('2.3 GB / 5.0 GB used');
    expect(formatBytes(480 * 1048576)).toBe('0.47 GB');
    expect(formatBytes(50 * 1048576)).toBe('50 MB');
    expect(formatBytes(0)).toBe('0 MB');
  });
});

describe('error wording', () => {
  it('recognises the server full marker and rewrites it', () => {
    expect(isStorageFullMessage('storage_full: Video storage is full (1 of 2 bytes used).')).toBe(true);
    expect(isStorageFullMessage('something else')).toBe(false);
    expect(friendlyVideoError('storage_full: x')).toMatch(/storage is full/i);
    expect(friendlyVideoError('Not authorized')).toBe('Not authorized');
    expect(friendlyVideoError(undefined)).toMatch(/Try again/);
  });
});
