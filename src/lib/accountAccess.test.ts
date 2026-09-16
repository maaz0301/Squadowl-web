import { describe, expect, it } from 'vitest';
import { daysUntil, deriveAccountAccess, isExpiredTrial } from './accountAccess';

const NOW = Date.parse('2026-09-16T12:00:00Z');
const FUTURE = '2026-10-01T00:00:00Z';
const PAST = '2026-09-01T00:00:00Z';

describe('deriveAccountAccess', () => {
  it('is active for a plain account', () => {
    expect(deriveAccountAccess({ subscription_status: 'none' }, NOW)).toBe('active');
  });

  it('is suspended whenever suspended_at is set, even while paying', () => {
    expect(deriveAccountAccess({ suspended_at: PAST, subscription_status: 'active' }, NOW)).toBe('suspended');
  });

  it('treats a Stripe trial as trial', () => {
    expect(deriveAccountAccess({ subscription_status: 'trialing' }, NOW)).toBe('trial');
  });

  it('is trial until a founder trial ends, then suspended', () => {
    expect(deriveAccountAccess({ trial_ends_at: FUTURE }, NOW)).toBe('trial');
    expect(deriveAccountAccess({ trial_ends_at: PAST }, NOW)).toBe('suspended');
  });

  it('lets an expired trial through once the account pays', () => {
    expect(deriveAccountAccess({ trial_ends_at: PAST, subscription_status: 'active' }, NOW)).toBe('active');
    expect(deriveAccountAccess({ trial_ends_at: PAST, subscription_status: 'past_due' }, NOW)).toBe('active');
  });

  it('never expires a comp account', () => {
    expect(deriveAccountAccess({ trial_ends_at: PAST, is_comp: true }, NOW)).toBe('active');
  });
});

describe('isExpiredTrial', () => {
  it('distinguishes a lapsed trial from a founder suspension', () => {
    expect(isExpiredTrial({ trial_ends_at: PAST }, NOW)).toBe(true);
    expect(isExpiredTrial({ suspended_at: PAST }, NOW)).toBe(false);
    expect(isExpiredTrial({ trial_ends_at: FUTURE }, NOW)).toBe(false);
  });
});

describe('daysUntil', () => {
  it('rounds up and floors at zero', () => {
    expect(daysUntil(NOW + 1.2 * 86_400_000, NOW)).toBe(2);
    expect(daysUntil(NOW - 1000, NOW)).toBe(0);
  });
});
