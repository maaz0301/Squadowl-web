'use client';

import { useLinkStatus } from 'next/link';
import { Spinner } from '@/components/ui';

/**
 * A "we heard you" spinner for cards that act as links.
 *
 * `loading.tsx` makes the transition itself instant once the route shell is
 * prefetched, but the prefetch can still be in flight on a cold or slow
 * connection — and that window is exactly when a tap feels ignored. This fills
 * it with the app's own loader. The wrapper is always rendered at a fixed size
 * so nothing shifts when the spinner appears, and the CSS holds it invisible
 * for the first ~120ms, which covers the fast case without a flash.
 *
 * Must be rendered inside a <Link>; useLinkStatus reads that link's transition.
 */
export function NavPending({ size = 16 }: { size?: number }) {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`nav-pending${pending ? ' is-pending' : ''}`}
      style={{ width: size, height: size }}
    >
      {pending ? <Spinner size={size} /> : null}
    </span>
  );
}
