import type { TeamInviteResult } from '@/data/types';

/**
 * Describe the outcome of a portal-invite send in words.
 *
 * Partial success is the normal outcome — a roster almost always has at least
 * one player with no email on file — so this never collapses to "sent" or
 * "failed": it names what went out, what bounced, and who had no address.
 *
 * Shared because the invite now fires automatically from several places (adding
 * a player to a season roster, adding players to a team, the manual Invite
 * button), and a coach should read the same sentence about the same outcome
 * wherever it happened.
 */
export function describeInviteResult(result: TeamInviteResult): {
  title: string;
  message: string;
  /** False when nothing at all was sent — the caller may want to stay quiet. */
  anySent: boolean;
} {
  const lines: string[] = [];
  if (result.sent.length > 0) {
    lines.push(
      `Invites sent to ${result.sent.length} ${result.sent.length === 1 ? 'address' : 'addresses'}.`,
    );
  }
  if (result.skipped.length > 0) lines.push(`No email on file for: ${result.skipped.join(', ')}.`);
  if (result.failed.length > 0) {
    // The reason rides along per address rather than being dropped on the
    // floor — "Could not send to x@y.com" alone gave no way to tell a bounced
    // address from an RLS rejection from a network blip, which is exactly the
    // distinction that matters for deciding whether to retry.
    lines.push(
      ...result.failed.map((f) => `Could not send to ${f.email}: ${f.message}`),
    );
  }
  if (lines.length === 0) lines.push('There was nobody to invite.');

  return {
    title: result.sent.length > 0 ? 'Invites Sent' : 'No Invites Sent',
    message: lines.join('\n\n'),
    anySent: result.sent.length > 0,
  };
}

/**
 * Whether an automatic send is worth interrupting the coach about.
 *
 * An invite that simply went out needs no dialog — it is the expected result of
 * adding a player, and a confirmation after every add is noise that trains
 * people to dismiss without reading. A bounce, or a player who ended up on the
 * roster with no way into the portal, is the coach's problem to fix and does.
 */
export function inviteNeedsAttention(result: TeamInviteResult): boolean {
  return result.failed.length > 0 || result.skipped.length > 0;
}

/** Merge per-player results into one, for a send that covered several players. */
export function mergeInviteResults(results: TeamInviteResult[]): TeamInviteResult {
  return results.reduce<TeamInviteResult>(
    (acc, r) => ({
      sent: [...acc.sent, ...r.sent],
      failed: [...acc.failed, ...r.failed],
      skipped: [...acc.skipped, ...r.skipped],
    }),
    { sent: [], failed: [], skipped: [] },
  );
}
