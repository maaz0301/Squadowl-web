'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { useSessionStore } from '@/state/sessionStore';

function normalizeParam(value: unknown): string | undefined {
  if (value == null) return undefined;
  return Array.isArray(value) ? String(value[0]) : String(value);
}

/** Resolves the assessment id from the route, falling back to the active session. */
export function useAssessmentId(): string | undefined {
  const params = useParams();
  const sessionId = useSessionStore((s) => s.currentTryoutId);
  return normalizeParam(params?.id) ?? sessionId ?? undefined;
}

/** True when the screen was opened from an "assigned to me" assessor link. */
export function useAssessorMode(): boolean {
  return useSearchParams().get('assessor') === '1';
}

/** Builds an in-assessment link that carries assessor mode along. */
export function useAssessmentHref(): (path: string) => string {
  const id = useAssessmentId();
  const assessor = useAssessorMode();
  return (path: string) => `/assessment/${id}/${path}${assessor ? '?assessor=1' : ''}`;
}
