'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, Button, Card, ErrorState, Input, LoadingState, Modal, PageHeader, SectionLabel, Spinner, useAlert } from '@/components/ui';
import { AssessmentHistory } from '@/components/player/AssessmentHistory';
import {
  usePlayerProfileQuery,
  useFamilyContactsQuery,
  useAddFamilyContactMutation,
  useRemoveFamilyContactMutation,
} from '@/features/queries';
import { usePermissions } from '@/state/authStore';
import { describeInvite, useInviteFamilyContact } from '@/features/useInviteFamilyContact';
import { playerDisplayName } from '@/data/rubrics';
import { formatBirth } from '@/lib/birthDate';
import type { ThemeColors } from '@/theme/tokens';

function Row({ label, value, colors }: { label: string; value?: string; colors: ThemeColors }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-sm" style={{ color: colors.inkMuted }}>{label}</span>
      <span className="flex-1 text-right text-sm font-medium" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '—'}
      </span>
    </div>
  );
}

function slugify(...parts: (string | undefined)[]): string {
  return (
    parts
      .filter(Boolean)
      .join('-')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'export'
  );
}

export default function PlayerProfilePage() {
  const { athleteId } = useParams<{ athleteId: string }>();
  const colors = useThemeColors();
  const { alert, confirm } = useAlert();
  const { isGuardian, role, canAssess, canManageTeam } = usePermissions();

  const profileQuery = usePlayerProfileQuery(athleteId);
  const profile = profileQuery.data;

  // Same extra-family-members feature as the assessment player page, added
  // here too — this is the profile a coach actually lands on from Teams,
  // Shared Athletes and Search, and it had no way to see or add them at all.
  const familyContactsQuery = useFamilyContactsQuery(athleteId);
  const addFamilyContactMut = useAddFamilyContactMutation(athleteId ?? '');
  const removeFamilyContactMut = useRemoveFamilyContactMutation(athleteId ?? '');
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactRelationship, setContactRelationship] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const inviteContact = useInviteFamilyContact();
  const [invitingContactId, setInvitingContactId] = useState<string | null>(null);

  // Coach / team manager only: it creates a login and grants access to the
  // athlete, which an assessor who merely scores them doesn't get to do.
  const inviteFamilyContact = async (contact: { id: string; name: string; email?: string }) => {
    if (!profile || !contact.email?.trim()) return;
    setInvitingContactId(contact.id);
    try {
      const result = await inviteContact(contact, {
        athleteId: profile.athleteId,
        linkedGuardianId: profile.linkedGuardianId,
        guardianEmail: profile.guardianEmail,
      });
      if (result) await alert('Invite Sent', describeInvite(result, contact.name, playerDisplayName(profile)));
    } catch (e) {
      await alert('Invite Failed', e instanceof Error ? e.message : 'Could not invite this contact.');
    } finally {
      setInvitingContactId(null);
    }
  };

  const submitFamilyContact = async () => {
    if (!contactName.trim()) {
      await alert('Missing Info', 'Enter at least a name.');
      return;
    }
    try {
      await addFamilyContactMut.mutateAsync({
        name: contactName.trim(),
        relationship: contactRelationship.trim() || undefined,
        email: contactEmail.trim() || undefined,
        phone: contactPhone.trim() || undefined,
      });
      setContactName('');
      setContactRelationship('');
      setContactEmail('');
      setContactPhone('');
      setShowAddContact(false);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not add this contact.');
    }
  };

  const confirmRemoveContact = async (contactId: string, name: string) => {
    const ok = await confirm({
      title: 'Remove Contact',
      message: `Remove ${name} from this athlete's family contacts?`,
      confirmLabel: 'Remove',
      destructive: true,
      requireText: 'DELETE',
    });
    if (!ok) return;
    try {
      await removeFamilyContactMut.mutateAsync(contactId);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not remove this contact.');
    }
  };

  if (profileQuery.isLoading) return <LoadingState />;
  if (profileQuery.isError || !profile) {
    return (
      <>
        <PageHeader title="Player" showBack />
        <ErrorState message="Player not found." onRetry={() => profileQuery.refetch()} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={playerDisplayName(profile)} showBack />

      <div className="flex flex-col items-center gap-2 py-4">
        <Avatar first={profile.first} last={profile.last} pos={profile.currentPosition} size={72} uri={profile.avatarUrl} />
        <span className="text-sm" style={{ color: colors.inkMuted }}>
          #{profile.jersey ?? '—'} · {profile.currentPosition ?? '—'}
        </span>
      </div>

      <Card className="mb-4 flex flex-col gap-2">
        <p className="font-display font-bold" style={{ color: colors.ink }}>Details</p>
        <Row label="Current Team" value={profile.currentTeam} colors={colors} />
        {profile.teams.length > 1 ? (
          <Row label="All Teams" value={profile.teams.map((t) => t.teamName).join(', ')} colors={colors} />
        ) : null}
        <Row label="Position" value={profile.currentPosition} colors={colors} />
        <Row label="Date of Birth" value={formatBirth(profile.dateOfBirth, profile.yearOfBirth)} colors={colors} />
        <Row label="Player Email" value={profile.playerEmail} colors={colors} />
        <Row label="Guardian" value={profile.guardianName} colors={colors} />
        <Row label="Guardian Email" value={profile.guardianEmail} colors={colors} />
        <Row label="Guardian Phone" value={profile.guardianPhone} colors={colors} />
      </Card>

      {profile.canViewMedical ? (
        <Card className="mb-4 flex flex-col gap-2">
          <p className="font-display font-bold" style={{ color: colors.ink }}>Additional Info</p>
          <Row label="Medical" value={profile.medicalInfo} colors={colors} />
        </Card>
      ) : null}

      {/* Open to anyone who can assess, same as the assessment player page. */}
      {canAssess ? (
        <Card className="mb-4 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <SectionLabel>Family Contacts</SectionLabel>
            <Button label="+ Add" size="sm" variant="ghost" onClick={() => setShowAddContact(true)} />
          </div>
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            A second parent, a grandparent, or anyone else who should get invites for this player.
          </p>
          {familyContactsQuery.isLoading ? (
            <Spinner size={16} />
          ) : (familyContactsQuery.data ?? []).length === 0 ? (
            <span style={{ color: colors.inkFaint }}>No additional contacts added yet.</span>
          ) : (
            <div className="flex flex-col gap-2">
              {(familyContactsQuery.data ?? []).map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0" style={{ borderColor: colors.border }}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium" style={{ color: colors.ink }}>
                      {c.name}
                      {c.relationship ? ` · ${c.relationship}` : ''}
                    </p>
                    {c.email ? <p className="truncate text-xs" style={{ color: colors.inkMuted }}>{c.email}</p> : null}
                    {c.phone ? <p className="truncate text-xs" style={{ color: colors.inkMuted }}>{c.phone}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {c.email && canManageTeam && role !== 'assessor' && !isGuardian ? (
                      <Button
                        label="Invite"
                        variant="secondary"
                        size="sm"
                        onClick={() => inviteFamilyContact(c)}
                        loading={invitingContactId === c.id}
                      />
                    ) : null}
                    <Button
                      label="Remove"
                      variant="ghost"
                      size="sm"
                      onClick={() => confirmRemoveContact(c.id, c.name)}
                      loading={removeFamilyContactMut.isPending && removeFamilyContactMut.variables === c.id}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {/* Assessment history is scores: the season-over-season averages, the
          trend and every evaluation's overall. It belongs to the coach who ran
          the assessments, so guardians get the profile without it rather than a
          read-only copy of it — they see the event's date, time and location in
          their own portal, and their athlete's results from the coach directly.
          Rows are non-interactive for everyone here — this profile is a
          read-only summary, not an entry point into the scoring flow.
          Assessors are excluded for the same reason: they score the assessment
          in front of them, and previous seasons are not theirs to read. */}
      {isGuardian || role === 'assessor' ? null : (
        <AssessmentHistory
          assessments={profile.assessments}
          colors={colors}
          exportFileName={slugify(profile.first, profile.last)}
          viewRecords
        />
      )}

      <Modal
        visible={showAddContact}
        title="Add Family Member"
        onClose={() => {
          if (addFamilyContactMut.isPending) return;
          setShowAddContact(false);
        }}
        hideDefaultFooter
      >
        <div className="flex flex-col gap-3">
          <Input label="Name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          <Input
            label="Relationship"
            value={contactRelationship}
            onChange={(e) => setContactRelationship(e.target.value)}
            placeholder="e.g. Grandmother, Emergency Contact"
          />
          <Input
            label="Email"
            type="email"
            autoCapitalize="none"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          <Input label="Phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          <Button
            label="Add Contact"
            onClick={submitFamilyContact}
            loading={addFamilyContactMut.isPending}
            disabled={!contactName.trim()}
          />
        </div>
      </Modal>
    </>
  );
}
