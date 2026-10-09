'use client';

import { useState } from 'react';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  BirthDateField,
  Button,
  Card,
  Input,
  Modal,
  PhoneField,
  Spinner,
  Textarea,
  useAlert,
} from '@/components/ui';
import {
  useAddFamilyContactMutation,
  useFamilyContactsQuery,
  useGuardianAthleteInfoQuery,
  useRemoveFamilyContactMutation,
  useUpdateGuardianAthleteMutation,
} from '@/features/queries';
import { formatBirth } from '@/lib/birthDate';

function InfoRow({ label, value, last }: { label: string; value?: string; last?: boolean }) {
  const colors = useThemeColors();
  return (
    <div
      className={`flex justify-between gap-3 py-2 ${last ? '' : 'border-b'}`}
      style={{ borderColor: colors.border }}
    >
      <span style={{ color: colors.inkMuted }}>{label}</span>
      <span className="flex-1 text-right font-medium" style={{ color: value ? colors.ink : colors.inkFaint }}>
        {value || '—'}
      </span>
    </div>
  );
}

/**
 * The guardian portal's Info tab: the athlete's details, which the guardian can
 * edit, and the extra family members they keep on the profile.
 */
export function GuardianAthleteInfo({
  athleteId,
  firstName,
  lastName,
}: {
  athleteId: string;
  firstName: string;
  lastName: string;
}) {
  const colors = useThemeColors();
  const { alert, confirm } = useAlert();
  const infoQuery = useGuardianAthleteInfoQuery(athleteId);
  const info = infoQuery.data;
  const updateAthlete = useUpdateGuardianAthleteMutation(athleteId);
  const contactsQuery = useFamilyContactsQuery(athleteId);
  const addContact = useAddFamilyContactMutation(athleteId);
  const removeContact = useRemoveFamilyContactMutation(athleteId);

  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState({
    first: '',
    last: '',
    yearOfBirth: '',
    dateOfBirth: '',
    playerEmail: '',
    guardianName: '',
    guardianPhone: '',
    medicalInfo: '',
    aboutChild: '',
  });
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const [showAddContact, setShowAddContact] = useState(false);
  const [contact, setContact] = useState({ name: '', relationship: '', email: '', phone: '' });

  const openEdit = () => {
    setForm({
      first: info?.first ?? firstName,
      last: info?.last ?? lastName,
      yearOfBirth: info?.yearOfBirth ?? '',
      dateOfBirth: info?.dateOfBirth ?? '',
      playerEmail: info?.playerEmail ?? '',
      guardianName: info?.guardianName ?? '',
      guardianPhone: info?.guardianPhone ?? '',
      medicalInfo: info?.medicalInfo ?? '',
      aboutChild: info?.aboutChild ?? '',
    });
    setShowEdit(true);
  };

  const save = async () => {
    if (!form.first.trim() || !form.last.trim()) {
      await alert('Missing Info', 'First and last name are required.');
      return;
    }
    try {
      await updateAthlete.mutateAsync(form);
      setShowEdit(false);
    } catch (e) {
      await alert('Could Not Save', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const submitContact = async () => {
    if (!contact.name.trim()) {
      await alert('Missing Info', 'Enter at least a name.');
      return;
    }
    try {
      await addContact.mutateAsync({
        name: contact.name.trim(),
        relationship: contact.relationship.trim() || undefined,
        email: contact.email.trim() || undefined,
        phone: contact.phone.trim() || undefined,
      });
      setContact({ name: '', relationship: '', email: '', phone: '' });
      setShowAddContact(false);
    } catch (e) {
      await alert('Could Not Add', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const confirmRemove = async (id: string, name: string) => {
    const ok = await confirm({
      title: 'Remove Family Member',
      message: `Remove ${name} from this profile?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeContact.mutateAsync(id);
    } catch (e) {
      await alert('Could Not Remove', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const contacts = contactsQuery.data ?? [];

  return (
    <div>
      <Card className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <p className="text-lg font-bold" style={{ color: colors.ink }}>Player Information</p>
          <Button label="Edit" size="sm" variant="secondary" onClick={openEdit} />
        </div>
        <InfoRow label="First Name" value={info?.first ?? firstName} />
        <InfoRow label="Last Name" value={info?.last ?? lastName} />
        <InfoRow label="Date of Birth" value={info ? formatBirth(info.dateOfBirth, info.yearOfBirth) : undefined} />
        <InfoRow label="Player Email" value={info?.playerEmail} />
        <InfoRow label="Guardian" value={info?.guardianName} />
        <InfoRow label="Guardian Email" value={info?.guardianEmail} />
        <InfoRow label="Guardian Phone" value={info?.guardianPhone} />
        <InfoRow label="Medical" value={info?.medicalInfo} last />
      </Card>

      <Card className="mb-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-lg font-bold" style={{ color: colors.ink }}>Family Members</p>
          <Button label="+ Add" size="sm" variant="ghost" onClick={() => setShowAddContact(true)} />
        </div>
        {contactsQuery.isLoading ? (
          <Spinner size={16} />
        ) : contacts.length === 0 ? (
          <span className="text-sm" style={{ color: colors.inkFaint }}>No additional family members added yet.</span>
        ) : (
          contacts.map((c) => (
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
              <Button
                label="Remove"
                variant="ghost"
                size="sm"
                onClick={() => confirmRemove(c.id, c.name)}
                loading={removeContact.isPending && removeContact.variables === c.id}
              />
            </div>
          ))
        )}
      </Card>

      <Card>
        <p className="mb-2 text-lg font-bold" style={{ color: colors.ink }}>Account Link</p>
        <p className="text-sm" style={{ color: colors.inkMuted }}>
          This athlete is linked to your guardian account. You will receive notifications and updates
          regarding their seasons and team events.
        </p>
      </Card>

      <Modal
        visible={showEdit}
        title="Edit Player"
        onClose={() => {
          if (!updateAthlete.isPending) setShowEdit(false);
        }}
        hideDefaultFooter
      >
        <div className="flex flex-col gap-3">
          <Input label="First Name" value={form.first} onChange={(e) => set('first')(e.target.value)} />
          <Input label="Last Name" value={form.last} onChange={(e) => set('last')(e.target.value)} />
          <BirthDateField
            label="Date of Birth"
            year={form.yearOfBirth}
            dateOfBirth={form.dateOfBirth}
            onChange={({ year, dateOfBirth }) => setForm((f) => ({ ...f, yearOfBirth: year, dateOfBirth }))}
          />
          <Input label="Player Email" type="email" value={form.playerEmail} onChange={(e) => set('playerEmail')(e.target.value)} />
          <Input label="Guardian Name" value={form.guardianName} onChange={(e) => set('guardianName')(e.target.value)} />
          <PhoneField label="Guardian Phone" value={form.guardianPhone} onChange={set('guardianPhone')} />
          <Textarea label="Medical Info" value={form.medicalInfo} onChange={(e) => set('medicalInfo')(e.target.value)} />
          <Textarea label="About (optional note for the coach)" value={form.aboutChild} onChange={(e) => set('aboutChild')(e.target.value)} />
          <Button label="Save" onClick={save} loading={updateAthlete.isPending} />
        </div>
      </Modal>

      <Modal
        visible={showAddContact}
        title="Add Family Member"
        onClose={() => {
          if (!addContact.isPending) setShowAddContact(false);
        }}
        hideDefaultFooter
      >
        <div className="flex flex-col gap-3">
          <Input label="Name" value={contact.name} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} />
          <Input
            label="Relationship"
            value={contact.relationship}
            onChange={(e) => setContact((c) => ({ ...c, relationship: e.target.value }))}
            placeholder="e.g. Parent, Grandmother, Emergency Contact"
          />
          <Input label="Email" type="email" value={contact.email} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} />
          <Input label="Phone" value={contact.phone} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} />
          <Button label="Add" onClick={submitContact} loading={addContact.isPending} disabled={!contact.name.trim()} />
        </div>
      </Modal>
    </div>
  );
}
