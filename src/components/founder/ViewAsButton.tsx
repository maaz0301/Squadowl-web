'use client';

import { Button, useAlert } from '@/components/ui';
import { useImpersonation } from '@/features/useImpersonation';

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
