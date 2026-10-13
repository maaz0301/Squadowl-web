'use client';

import { useState } from 'react';
import { Button, Input, Modal, ModalFooter, Textarea, useAlert } from '@/components/ui';
import type { FounderUser } from '@/data/founder/types';
import { useDebouncedValue } from '@/lib/hooks';
import { useFounderUsersQuery, useMergeFounderUsersMutation, useSetFounderUserRoleMutation } from '@/features/founderQueries';
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
  requireText,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  loading: boolean;
  /** When set, the confirm button stays disabled until this exact text is typed. */
  requireText?: string;

  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [typed, setTyped] = useState('');
  const blocked = !!requireText && typed.trim() !== requireText;

  const close = () => {
    setReason('');
    setTyped('');
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
          <Button label={confirmLabel} variant="danger" loading={loading} disabled={blocked} onClick={() => onConfirm(reason)} />
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
      {requireText ? (
        <Input
          label={`Type ${requireText} to confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={requireText}
          autoComplete="off"
        />
      ) : null}
    </Modal>
  );
}

// ─── Merge duplicate accounts ───────────────────────────────────────────────

/**
 * Folds `user` (the duplicate) into an account the founder picks. Their
 * memberships, children, comments, shares and the rest move across, the higher
 * role wins where both belong to the same club, and the duplicate is banned.
 */
export function MergeUserModal({ user, onClose }: { user: FounderUser | null; onClose: () => void }) {
  const { alert, confirm, toast } = useAlert();
  const merge = useMergeFounderUsersMutation();
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState<FounderUser | null>(null);
  const term = useDebouncedValue(search.trim(), 300);
  const results = useFounderUsersQuery({ search: term || undefined, limit: 8 }, !!user && term.length >= 3);
  const candidates = (results.data?.items ?? []).filter((u) => u.id !== user?.id);

  const close = () => {
    setSearch('');
    setReason('');
    setTarget(null);
    onClose();
  };

  const submit = async () => {
    if (!user || !target) return;
    const ok = await confirm({
      title: 'Merge Accounts',
      message: `Move everything from ${user.email ?? 'the duplicate'} into ${target.email ?? 'the chosen account'}, then ban ${
        user.email ?? 'the duplicate'
      }? This cannot be undone from the console.`,
      confirmLabel: 'Merge',
    });
    if (!ok) return;
    try {
      const r = await merge.mutateAsync({ fromUserId: user.id, intoUserId: target.id, reason });
      toast(`Merged. ${r.moved} records moved, ${r.dropped} duplicates dropped.`, 'success');
      close();
    } catch (e) {
      await alert('Could Not Merge', errorMessage(e));
    }
  };

  return (
    <Modal
      visible={!!user}
      title="Merge Duplicate Account"
      size="sm"
      onClose={close}
      hideDefaultFooter
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="ghost" onClick={close} />
          <Button label="Merge" variant="danger" disabled={!target} loading={merge.isPending} onClick={submit} />
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-sm break-words">
          Duplicate to retire: <strong>{user?.email ?? user?.displayName}</strong>
        </p>
        <Input
          label="Account to keep (search by name or email)"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setTarget(null);
          }}
          hint="Type at least 3 letters."
        />
        {candidates.map((u) => (
          <Button
            key={u.id}
            label={`${u.displayName ? u.displayName + ' - ' : ''}${u.email ?? u.id}`}
            variant={target?.id === u.id ? 'primary' : 'ghost'}
            onClick={() => setTarget(u)}
          />
        ))}
        {term.length >= 3 && !results.isLoading && candidates.length === 0 ? (
          <p className="text-sm">No other accounts match.</p>
        ) : null}
        <Textarea label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}
