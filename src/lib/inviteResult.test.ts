import { describe, expect, it } from 'vitest';

import { describeInviteResult, inviteNeedsAttention, mergeInviteResults } from './inviteResult';
import type { TeamInviteResult } from '@/data/types';

const empty: TeamInviteResult = { sent: [], failed: [], skipped: [] };

describe('describeInviteResult', () => {
  it('counts a clean send', () => {
    const { title, message, anySent } = describeInviteResult({
      ...empty,
      sent: ['a@example.com', 'b@example.com'],
    });
    expect(title).toBe('Invites Sent');
    expect(message).toBe('Invites sent to 2 addresses.');
    expect(anySent).toBe(true);
  });

  it('says "address" for one', () => {
    expect(describeInviteResult({ ...empty, sent: ['a@example.com'] }).message).toBe(
      'Invites sent to 1 address.',
    );
  });

  it('names everything at once on a partial send', () => {
    const { title, message } = describeInviteResult({
      sent: ['a@example.com'],
      failed: [{ email: 'b@example.com', message: 'bounced' }],
      skipped: ['Jordan Reyes'],
    });
    expect(title).toBe('Invites Sent');
    expect(message).toContain('Invites sent to 1 address.');
    expect(message).toContain('No email on file for: Jordan Reyes.');
    expect(message).toContain('Could not send to b@example.com: bounced');
  });

  it('shows a distinct reason for each failed address', () => {
    const { message } = describeInviteResult({
      ...empty,
      failed: [
        { email: 'b@example.com', message: 'bounced' },
        { email: 'c@example.com', message: 'new row violates row-level security policy' },
      ],
    });
    expect(message).toContain('Could not send to b@example.com: bounced');
    expect(message).toContain(
      'Could not send to c@example.com: new row violates row-level security policy',
    );
  });

  it('does not claim success when only failures came back', () => {
    const { title, anySent } = describeInviteResult({
      ...empty,
      failed: [{ email: 'b@example.com', message: 'bounced' }],
    });
    expect(title).toBe('No Invites Sent');
    expect(anySent).toBe(false);
  });

  it('has something to say about an entirely empty result', () => {
    expect(describeInviteResult(empty).message).toBe('There was nobody to invite.');
  });
});

describe('inviteNeedsAttention', () => {
  it('stays quiet when everything went out', () => {
    expect(inviteNeedsAttention({ ...empty, sent: ['a@example.com'] })).toBe(false);
  });

  it('speaks up about a bounce', () => {
    expect(
      inviteNeedsAttention({ ...empty, failed: [{ email: 'b@example.com', message: 'no' }] }),
    ).toBe(true);
  });

  it('speaks up about a player with no address on file', () => {
    expect(inviteNeedsAttention({ ...empty, skipped: ['Jordan Reyes'] })).toBe(true);
  });

  it('stays quiet about nothing at all', () => {
    expect(inviteNeedsAttention(empty)).toBe(false);
  });
});

describe('mergeInviteResults', () => {
  it('concatenates every bucket', () => {
    expect(
      mergeInviteResults([
        { sent: ['a@example.com'], failed: [], skipped: ['Sam'] },
        { sent: ['b@example.com'], failed: [{ email: 'c@example.com', message: 'no' }], skipped: [] },
      ]),
    ).toEqual({
      sent: ['a@example.com', 'b@example.com'],
      failed: [{ email: 'c@example.com', message: 'no' }],
      skipped: ['Sam'],
    });
  });

  it('merges nothing into an empty result', () => {
    expect(mergeInviteResults([])).toEqual(empty);
  });
});
