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

/**
 * Whether this viewer gets the assessor's cut of the assessment in front of
 * them — no Results, no Settings, no other evaluator's scores.
 *
 * `?assessor=1` is a first-paint hint, not the answer. The dashboard's
 * "Assigned to me" links carry it for everyone listed in `tryout_assessors`,
 * and useAssessmentHref() then threads it through every in-assessment link —
 * so a delegated team manager who is *also* an assessor on an evaluation on
 * their own team opened it from that list and was pinned to the assessor view
 * of an assessment they own, for the rest of the session. ORing the parameter
 * in is what did that: nothing could ever clear it.
 *
 * `viewerIsOwner` is the real answer — server-computed per tryout from your
 * account, a team you manage, or being its lead assessor — so it wins the
 * moment it has loaded. The parameter decides only the frames before that,
 * where it is still right for the assessor it was minted for.
 */
export function useIsAssessorOnly(viewerIsOwner: boolean | undefined): boolean {
  const param = useAssessorMode();
  return viewerIsOwner === undefined ? param : !viewerIsOwner;
}

/** Builds an in-assessment link that carries assessor mode along. */
export function useAssessmentHref(): (path: string) => string {
  const id = useAssessmentId();
  const assessor = useAssessorMode();
  return (path: string) => `/assessment/${id}/${path}${assessor ? '?assessor=1' : ''}`;
}
