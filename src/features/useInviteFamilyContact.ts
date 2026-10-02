'use client';

import {
  useCreateAndInviteMemberMutation,
  useInviteMemberMutation,
  useLinkFamilyContactGuardianMutation,
  useLinkGuardianMutation,
} from '@/features/queries';

export interface InviteFamilyContactResult {
  email: string;
  /** Set when a new login was created for the contact; the email carries it too. */
  tempPassword?: string;
  /** Whether the contact can now see the athlete in the guardian portal. */
  connected: boolean;
}

/** What the invite needs to know about the athlete the contact belongs to. */
export interface InviteFamilyContactAthlete {
  athleteId: string;
  /** The athlete's linked guardian login, if any. */
  linkedGuardianId?: string;
  /** The guardian email on file, linked or not. */
  guardianEmail?: string;
  /** Only for the cache refresh after linking; any evaluation id, or '' outside one. */
  tryoutId?: string;
}

const makeTempPassword = () => Math.random().toString(36).slice(-6) + 'Aa1!';

/**
 * Invite a family contact to the guardian portal: reuse their login or create
 * one (the email carries a temporary password) and connect it to the athlete.
 *
 * The athlete row holds a single guardian link and writing it replaces the
 * previous one, so a contact only becomes that guardian when the slot is free
 * (nobody linked, and no different guardian email on file). Anyone else is
 * connected as an additional guardian beside it, which is left as it is.
 *
 * Throws on a failed invite; `connected` is false when the database update that
 * allows additional guardians has not been applied.
 */
export function useInviteFamilyContact() {
  const inviteMut = useInviteMemberMutation();
  const createAndInviteMut = useCreateAndInviteMemberMutation();
  const linkGuardianMut = useLinkGuardianMutation();
  const linkContactGuardianMut = useLinkFamilyContactGuardianMutation();

  return async (
    contact: { id: string; name: string; email?: string },
    athlete: InviteFamilyContactAthlete,
  ): Promise<InviteFamilyContactResult | null> => {
    const email = contact.email?.trim();
    if (!email) return null;

    let userId: string | undefined;
    let tempPassword: string | undefined;
    try {
      userId = (await inviteMut.mutateAsync({ email, role: 'guardian' })).userId;
    } catch (error) {
      if (!(error instanceof Error && error.message?.includes('User not found'))) throw error;
      tempPassword = makeTempPassword();
      userId = (
        await createAndInviteMut.mutateAsync({
          email,
          password: tempPassword,
          name: contact.name || 'Guardian',
          role: 'guardian',
        })
      ).userId;
    }

    const slotFree =
      !athlete.linkedGuardianId &&
      (!athlete.guardianEmail || athlete.guardianEmail.toLowerCase() === email.toLowerCase());
    let connected = slotFree || (!!userId && athlete.linkedGuardianId === userId);
    if (userId && slotFree) {
      await linkGuardianMut.mutateAsync({
        guardianId: userId,
        tryoutId: athlete.tryoutId ?? '',
        playerId: athlete.athleteId,
      });
    } else if (userId && !connected) {
      connected = await linkContactGuardianMut.mutateAsync({ contactId: contact.id, userId });
    }
    return { email, tempPassword, connected };
  };
}

/** The coach-facing sentence for one invite result. */
export function describeInvite(result: InviteFamilyContactResult, contactName: string, athleteName: string): string {
  const sent = result.tempPassword
    ? `An account was created for ${result.email} and an email was sent with their temporary password:\n\n${result.tempPassword}`
    : `An invitation was sent to ${result.email}.`;
  return result.connected
    ? `${sent}\n\nThey are now connected to ${athleteName}.`
    : `${sent}\n\n${contactName} could not be connected to ${athleteName} yet. The update that lets several family members share one athlete has not been applied.`;
}

/**
 * Invite the family members marked in an Add Player form, once the player and
 * their contacts are saved. One failure doesn't stop the rest; the result is
 * one line per person for the coach to read.
 */
export function useInviteSavedFamilyContacts() {
  const invite = useInviteFamilyContact();
  return async (
    athlete: InviteFamilyContactAthlete,
    athleteName: string,
    items: { contact: { id: string; name: string; email?: string }; invite?: boolean }[],
  ): Promise<string[]> => {
    const lines: string[] = [];
    for (const { contact, invite: marked } of items) {
      if (!marked || !contact.email?.trim()) continue;
      try {
        const result = await invite(contact, athlete);
        if (result) lines.push(describeInvite(result, contact.name, athleteName));
      } catch (e) {
        lines.push(`${contact.name || contact.email} could not be invited: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }
    }
    return lines;
  };
}
