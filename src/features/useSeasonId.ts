'use client';

import { useParams } from 'next/navigation';

/** Season id from the /season/[id] route. */
export function useSeasonId(): string | undefined {
  const params = useParams();
  const id = params?.id;
  if (id == null) return undefined;
  return Array.isArray(id) ? String(id[0]) : String(id);
}
