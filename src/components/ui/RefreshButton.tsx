'use client';

import { useState } from 'react';
import { Button } from './Button';

/**
 * Re-reads what a page shows. Hand it the refetches for the page's queries; the
 * button spins until they settle. A failed refetch is not thrown at the user,
 * since the page's own error state already says what is wrong.
 */
export function RefreshButton({ onRefresh }: { onRefresh: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onRefresh();
    } catch {
      // See above.
    } finally {
      setBusy(false);
    }
  };
  return <Button label="Refresh" variant="secondary" size="sm" loading={busy} disabled={busy} onClick={run} />;
}
