'use client';

import { Button, useAlert } from '@/components/ui';
import { useImpersonation } from '@/features/useImpersonation';
import type { ImpersonationTarget } from '@/state/impersonationStore';

/**
 * Opens the normal app as this organization's admin would see it — read-only,
 * with an Exit banner, and recorded in the founder audit log.
 */
export function ViewAsButton({
  accountId,
  accountName,
  size = 'sm',
  variant = 'secondary',
}: {
  accountId: string;
  accountName: string;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const { alert, confirm } = useAlert();
  const { start, pending } = useImpersonation();

  const open = async () => {
    const ok = await confirm({
      title: 'View as Organization',
      message: `Open the app as ${accountName || 'this organization'} sees it, to troubleshoot. It's read-only — nothing can be saved — and entering and leaving are recorded in the audit log.`,
      confirmLabel: 'View as Org',
      // Switching into a fresh "view as" is allowed even from inside an
      // existing one (e.g. drilling into a different org from the founder
      // console while already viewing as someone) — it changes the display,
      // not the data, so it isn't the edit the read-only guard exists for.
      allowWhileViewingAs: true,
    });
    if (!ok) return;
    try {
      await start(accountId, accountName);
    } catch (e) {
      await alert('Could Not Switch', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  return <Button label="View as Org" size={size} variant={variant} loading={pending} onClick={open} />;
}

/**
 * Opens the normal app as one person sees it — their own role, the teams
 * delegated to them, the evaluations they're assigned to assess and any
 * athletes they're guardian of. Read-only, like View as Org; the audit log
 * records the organization it was opened from.
 */
export function ViewAsUserButton({
  accountId,
  accountName,
  user,
  size = 'sm',
  variant = 'ghost',
}: {
  accountId: string;
  accountName: string;
  user: NonNullable<ImpersonationTarget['user']>;
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary' | 'ghost';
}) {
  const { alert, confirm } = useAlert();
  const { start, pending } = useImpersonation();
  const who = user.name || user.email || 'this user';

  const open = async () => {
    const ok = await confirm({
      title: 'View as User',
      message: `Open the app exactly as ${who} sees it — their teams, managed teams and assessor assignments — to troubleshoot. It's read-only, and entering and leaving are recorded in ${accountName || 'this organization'}'s audit log.`,
      confirmLabel: 'View as User',
      allowWhileViewingAs: true,
    });
    if (!ok) return;
    try {
      await start(accountId, accountName, user);
    } catch (e) {
      await alert('Could Not Switch', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  return <Button label="View as User" size={size} variant={variant} loading={pending} onClick={open} />;
}
