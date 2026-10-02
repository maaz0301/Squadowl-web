'use client';

import { useState } from 'react';

import { Badge, Button, Card, Spinner, useAlert } from '@/components/ui';
import { useConnectedFamilyContactIdsQuery, useFamilyContactsQuery } from '@/features/queries';
import { describeInvite, useInviteFamilyContact } from '@/features/useInviteFamilyContact';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * The additional family members on an athlete, beside the guardian on file:
 * who they are, whether they are connected to the guardian portal, and (for a
 * coach or team manager) an Invite that creates their login and connects them.
 */
export function PlayerFamilyContactsCard({
  athleteId,
  athleteName,
  linkedGuardianId,
  guardianEmail,
  canInvite,
}: {
  athleteId: string;
  athleteName: string;
  linkedGuardianId?: string;
  guardianEmail?: string;
  canInvite: boolean;
}) {
  const colors = useThemeColors();
  const { alert } = useAlert();
  const contactsQuery = useFamilyContactsQuery(athleteId);
  const connectedQuery = useConnectedFamilyContactIdsQuery(athleteId);
  const inviteContact = useInviteFamilyContact();
  const [invitingId, setInvitingId] = useState<string | null>(null);

  const contacts = contactsQuery.data ?? [];
  const connected = new Set(connectedQuery.data ?? []);

  const invite = async (contact: { id: string; name: string; email?: string }) => {
    setInvitingId(contact.id);
    try {
      const result = await inviteContact(contact, { athleteId, linkedGuardianId, guardianEmail });
      if (result) {
        await alert('Invite Sent', describeInvite(result, contact.name, athleteName));
        void connectedQuery.refetch();
      }
    } catch (e) {
      await alert('Invite Failed', e instanceof Error ? e.message : 'Could not invite this contact.');
    } finally {
      setInvitingId(null);
    }
  };

  return (
    <Card className="flex flex-col gap-2">
      <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
        Family Contacts
      </span>
      {contactsQuery.isLoading ? (
        <Spinner size={16} />
      ) : contacts.length === 0 ? (
        <span className="text-sm" style={{ color: colors.inkFaint }}>No additional contacts added yet.</span>
      ) : (
        <div className="flex flex-col gap-2">
          {contacts.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0"
              style={{ borderColor: colors.border }}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" style={{ color: colors.ink }}>
                  {c.name}
                  {c.relationship ? ` · ${c.relationship}` : ''}
                </p>
                {c.email ? <p className="truncate text-xs" style={{ color: colors.inkMuted }}>{c.email}</p> : null}
                {c.phone ? <p className="truncate text-xs" style={{ color: colors.inkMuted }}>{c.phone}</p> : null}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {connected.has(c.id) ? <Badge label="Connected" variant="success" /> : null}
                {canInvite && c.email && !connected.has(c.id) ? (
                  <Button
                    label="Invite"
                    variant="secondary"
                    size="sm"
                    onClick={() => invite(c)}
                    loading={invitingId === c.id}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
