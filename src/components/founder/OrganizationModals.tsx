'use client';

import { useState } from 'react';
import { Button, Checkbox, Input, Modal, ModalFooter, Select, Textarea, useAlert } from '@/components/ui';
import type { FounderAccessKind, FounderOrganization } from '@/data/founder/types';
import {
  useCreateFounderOrganizationMutation,
  useSetOrganizationSuspendedMutation,
  useUpdateOrganizationAccessMutation,
} from '@/features/founderQueries';
import { daysUntil } from '@/lib/accountAccess';
import { ACCESS_OPTIONS, PLAN_OPTIONS } from './labels';

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function parseTrialDays(value: string): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null;
}

// ─── Suspend ────────────────────────────────────────────────────────────────

export function SuspendOrganizationModal({ org, onClose }: { org: FounderOrganization | null; onClose: () => void }) {
  const { alert, toast } = useAlert();
  const suspend = useSetOrganizationSuspendedMutation();
  const [reason, setReason] = useState('');

  const close = () => {
    setReason('');
    onClose();
  };

  const submit = async () => {
    if (!org) return;
    try {
      await suspend.mutateAsync({ accountId: org.id, suspended: true, reason });
      toast(`${org.name} suspended.`, 'success');
      close();
    } catch (e) {
      await alert('Could Not Suspend', errorMessage(e));
    }
  };

  return (
    <Modal
      visible={!!org}
      title="Suspend Organization"
      size="sm"
      onClose={close}
      hideDefaultFooter
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="ghost" onClick={close} />
          <Button label="Suspend" variant="danger" loading={suspend.isPending} onClick={submit} />
        </ModalFooter>
      }
    >
      <p className="mb-4 text-sm break-words">
        Every member of <strong>{org?.name}</strong> loses access to its teams, evaluations and data right away.
        Nothing is deleted, and reactivating restores everything.
      </p>
      <Textarea
        label="Reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Pilot ended, unpaid invoice…"
        rows={3}
        maxLength={500}
      />
    </Modal>
  );
}

// ─── Plan & access ──────────────────────────────────────────────────────────

export function EditAccessModal({ org, onClose }: { org: FounderOrganization | null; onClose: () => void }) {
  const { alert, toast } = useAlert();
  const update = useUpdateOrganizationAccessMutation();
  // Seeded from the org on open; the modal is keyed by org id so this resets per org.
  const [planTier, setPlanTier] = useState(org?.planTier ?? 'free');
  const [access, setAccess] = useState<FounderAccessKind>(
    org?.isComp ? 'comp' : org?.trialEndsAt ? 'trial' : 'active',
  );
  const [trialDays, setTrialDays] = useState(
    String(org?.trialEndsAt ? Math.max(1, daysUntil(org.trialEndsAt)) : 30),
  );

  const submit = async () => {
    if (!org) return;
    const days = parseTrialDays(trialDays);
    if (access === 'trial' && days == null) {
      await alert('Check Trial Length', 'Enter a whole number of days from 1 to 365.');
      return;
    }
    try {
      await update.mutateAsync({ accountId: org.id, planTier, access, trialDays: days ?? undefined });
      toast(`${org.name} updated.`, 'success');
      onClose();
    } catch (e) {
      await alert('Could Not Update', errorMessage(e));
    }
  };

  return (
    <Modal
      visible={!!org}
      title="Plan & Access"
      size="sm"
      onClose={onClose}
      hideDefaultFooter
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="ghost" onClick={onClose} />
          <Button label="Save" loading={update.isPending} onClick={submit} />
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm break-words">
          <strong>{org?.name}</strong>
        </p>
        <Select label="Plan tier" value={planTier} onChange={(e) => setPlanTier(e.target.value)} options={PLAN_OPTIONS} />
        <Select
          label="Access"
          value={access}
          onChange={(e) => setAccess(e.target.value as FounderAccessKind)}
          options={ACCESS_OPTIONS}
        />
        {access === 'trial' ? (
          <Input
            label="Trial length (days from today)"
            type="number"
            min={1}
            max={365}
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
            hint="When it runs out without a paid subscription, the organization is suspended automatically."
          />
        ) : null}
        {org?.accessStatus === 'suspended' ? (
          <p className="text-xs">This does not lift the suspension — use Reactivate for that.</p>
        ) : null}
      </div>
    </Modal>
  );
}

// ─── Manual creation ────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: '',
  ownerEmail: '',
  ownerName: '',
  planTier: 'club',
  access: 'comp' as FounderAccessKind,
  trialDays: '30',
  sendInvite: true,
};

export function CreateOrganizationModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { alert, toast } = useAlert();
  const create = useCreateFounderOrganizationMutation();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<'name' | 'ownerEmail' | 'trialDays', string>>>({});

  const set = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const close = () => {
    setForm(EMPTY_FORM);
    setErrors({});
    onClose();
  };

  const submit = async () => {
    const days = parseTrialDays(form.trialDays);
    const nextErrors = {
      name: form.name.trim() ? undefined : 'Required',
      ownerEmail: EMAIL_RE.test(form.ownerEmail.trim()) ? undefined : 'Enter a valid email',
      trialDays: form.access === 'trial' && days == null ? '1–365 days' : undefined,
    };
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    try {
      const result = await create.mutateAsync({
        name: form.name,
        ownerEmail: form.ownerEmail,
        ownerName: form.ownerName,
        planTier: form.planTier,
        access: form.access,
        trialDays: days ?? undefined,
        sendInvite: form.sendInvite,
      });
      const name = form.name.trim();
      const email = form.ownerEmail.trim();
      close();
      if (result.temporaryPassword) {
        await alert(
          'Organization Created',
          `${name} is ready. A new user was created for ${email} with the temporary password ${result.temporaryPassword} — share it with them securely; it is not shown again.`,
        );
      } else if (form.sendInvite && !result.inviteSent) {
        await alert(
          'Organization Created',
          `${name} is ready, but the invite email to ${email} could not be sent. They can sign in with "Forgot password".`,
        );
      } else {
        toast(`${name} created${result.inviteSent ? ` — invite sent to ${email}` : ''}.`, 'success');
      }
    } catch (e) {
      await alert('Could Not Create', errorMessage(e));
    }
  };

  return (
    <Modal
      visible={visible}
      title="New Organization"
      onClose={close}
      hideDefaultFooter
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="ghost" onClick={close} />
          <Button label="Create Organization" loading={create.isPending} onClick={submit} />
        </ModalFooter>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          containerClassName="sm:col-span-2"
          label="Organization name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
          placeholder="e.g. MSBA"
          maxLength={120}
        />
        <Input
          label="Owner / admin email"
          type="email"
          autoComplete="off"
          value={form.ownerEmail}
          onChange={(e) => set('ownerEmail', e.target.value)}
          error={errors.ownerEmail}
        />
        <Input
          label="Owner name (optional)"
          value={form.ownerName}
          onChange={(e) => set('ownerName', e.target.value)}
          hint="Used only if a new user is created."
        />
        <Select label="Plan tier" value={form.planTier} onChange={(e) => set('planTier', e.target.value)} options={PLAN_OPTIONS} />
        <Select
          label="Access"
          value={form.access}
          onChange={(e) => set('access', e.target.value as FounderAccessKind)}
          options={ACCESS_OPTIONS}
        />
        {form.access === 'trial' ? (
          <Input
            label="Trial length (days)"
            type="number"
            min={1}
            max={365}
            value={form.trialDays}
            onChange={(e) => set('trialDays', e.target.value)}
            error={errors.trialDays}
          />
        ) : null}
        <div className="sm:col-span-2">
          <Checkbox
            checked={form.sendInvite}
            onChange={(v) => set('sendInvite', v)}
            label="Email the owner an invite (includes a temporary password if they're new)"
          />
        </div>
      </div>
    </Modal>
  );
}
