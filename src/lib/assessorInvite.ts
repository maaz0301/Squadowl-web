import type { Assessor } from '@/data/types';

export type AssessorInviteStatus = 'pending' | 'accepted' | 'declined' | 'completed';

/**
 * How an invitation is reading right now, from the outside — the inviting
 * coach's Settings list, and the founder's read-only "view as". Spelled out
 * rather than echoing the raw status word: "pending" on its own left the coach
 * unsure whether it meant the email hadn't gone out or the assessor hadn't
 * answered yet. `title` carries the longer explanation on hover.
 */
export const INVITE_STATUS: Record<
  AssessorInviteStatus,
  { label: string; variant: 'warning' | 'success' | 'danger'; title: string }
> = {
  completed: {
    label: 'Assessing complete',
    variant: 'success',
    title: 'They finished scoring and closed this evaluation on their side. All of their scores are kept here.',
  },
  pending: {
    label: 'Invite pending',
    variant: 'warning',
    title: "Invited — waiting for them to accept. They'll see it after signing in with the address it was sent to.",
  },
  accepted: {
    label: 'Invite accepted',
    variant: 'success',
    title: 'They accepted and can score this evaluation.',
  },
  declined: {
    label: 'Invite declined',
    variant: 'danger',
    title: 'They declined this invitation.',
  },
};

/**
 * The assessor row an "Assigned to me" card belongs to — the one whose status
 * says whether the invite was accepted.
 *
 * `viewedIds` is the founder's "view as" (getViewedPersonIds()), and it takes
 * precedence over the signed-in identity. View as *organization* keeps running
 * as the founder — resolveUserId() deliberately doesn't swap the identity
 * there — while the assigned list it reads is every member's assignments, so
 * matching the signed-in user's id found no row at all and every accepted
 * assignment read back as still waiting to be accepted. View as *user* resolves
 * to that one person, which is the id this returns for them anyway.
 */
export function findViewersAssessorRow(
  assessors: Assessor[],
  viewer: { id?: string; email?: string } | null | undefined,
  viewedIds: string[],
): Assessor | undefined {
  if (viewedIds.length) {
    const ids = new Set(viewedIds);
    return assessors.find((a) => !!a.userId && ids.has(a.userId));
  }
  const email = viewer?.email?.toLowerCase();
  return assessors.find(
    (a) => (!!viewer?.id && a.userId === viewer.id) || (!!email && a.email?.toLowerCase() === email),
  );
}
