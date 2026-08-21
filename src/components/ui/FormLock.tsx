'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Freezes every control inside it while a submit is in flight.
 *
 * A native `<fieldset disabled>` rather than a `disabled` prop threaded through
 * each field: it disables every nested form control at once — inputs, selects,
 * textareas, and the `<button>`s behind Chips, colour pickers and file pickers —
 * so a field added to a form later is covered without anyone remembering to wire
 * it up. It also blocks keyboard and programmatic focus, which a `pointer-events`
 * class alone would not.
 *
 * Keep the submit button *outside* this wrapper: it has its own loading state,
 * and the dimming below would otherwise wash out the spinner and any progress
 * bar sitting next to it.
 */
export function FormLock({
  busy,
  className,
  children,
}: {
  busy?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <fieldset
      disabled={busy}
      aria-busy={busy}
      // Browsers give fieldset its own border, padding and an intrinsic
      // min-inline-size that refuses to shrink inside flex/grid parents; all
      // three are reset so it lays out exactly like the div it replaces.
      className={cn('m-0 min-w-0 border-0 p-0 transition-opacity', busy && 'opacity-60', className)}
    >
      {children}
    </fieldset>
  );
}
