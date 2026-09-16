'use client';

import { useState } from 'react';
import { Button, Modal, ModalFooter, Textarea, useAlert } from '@/components/ui';
import type { FounderUser } from '@/data/founder/types';
import { useSetFounderUserRoleMutation } from '@/features/founderQueries';
import { USER_ROLE_OPTIONS } from './labels';

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong.');

// ─── Role ───────────────────────────────────────────────────────────────────

export function SetUserRoleModal({
  user,
  accountId,
  onClose,
}: {
  user: FounderUser | null;
  accountId: string | null;
  onClose: () => void;
}) {
  const { alert, toast } = useAlert();
  const setRole = useSetFounderUserRoleMutation();
  const membership = user?.memberships.find((m) => m.accountId === accountId);

  return (
    <Modal visible={!!user && !!accountId} title="Change Role" size="sm" onClose={onClose} hideDefaultFooter>
      <p className="mb-4 text-sm break-words">
        <strong>{user?.email ?? user?.displayName ?? 'This person'}</strong> in{' '}
        <strong>{membership?.accountName ?? 'this organization'}</strong>
      </p>
      <div className="flex flex-col gap-2">
        {USER_ROLE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            label={opt.label}
            variant={membership?.role === opt.value ? 'primary' : 'ghost'}
            loading={setRole.isPending}
            onClick={async () => {
              if (!user || !accountId || membership?.role === opt.value) {
                onClose();
                return;
              }
              try {
                await setRole.mutateAsync({ userId: user.id, accountId, role: opt.value });
                toast(`Role updated to ${opt.label}.`, 'success');
                onClose();
              } catch (e) {
                await alert('Could Not Update', errorMessage(e));
              }
            }}
          />
        ))}
      </div>
    </Modal>
  );
}

// ─── Ban / delete — same shape, an optional reason kept for the audit log ────

export function UserReasonModal({
  visible,
  title,
  message,
  confirmLabel,
  loading,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');

  const close = () => {
    setReason('');
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={title}
      size="sm"
      onClose={close}
      hideDefaultFooter
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="ghost" onClick={close} />
          <Button label={confirmLabel} variant="danger" loading={loading} onClick={() => onConfirm(reason)} />
        </ModalFooter>
      }
    >
      <p className="mb-4 text-sm break-words">{message}</p>
      <Textarea
        label="Reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Abuse report, requested by the user…"
        rows={3}
        maxLength={500}
      />
    </Modal>
  );
}
