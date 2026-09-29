'use client';

import { useTerms, sportLabel } from '@/lib/terms';
import { use, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { MapLink } from '@/components/MapLink';
import { Badge } from '@/components/ui';
import { useRegistrationsQuery, useTryoutQuery, useTryoutRealtimeSync } from '@/features/queries';
import { useIsAssessorOnly } from '@/features/useAssessmentId';
import { useSessionStore } from '@/state/sessionStore';

interface TabDef {
  slug: string;
  label: string;
  /** Sub-screens that should keep this tab highlighted, like the app's tab bar. */
  owns?: string[];
  assessorHidden?: boolean;
}

const TABS: TabDef[] = [
  {
    slug: 'roster',
    label: 'Roster',
    owns: ['player', 'score', 'rinkside', 'team-builder', 'compare', 'roster-library', 'scan-sheet', 'letters'],
  },
  { slug: 'registrations', label: 'Registrations', assessorHidden: true },
  // Results is the scoreboard — every player's overall, rank and the coach's
  // recommendation. Assessors enter scores; reading the whole field back is
  // the coach's, so this hides with the rest of the coach-only tabs.
  { slug: 'results', label: 'Results', assessorHidden: true },
  { slug: 'settings', label: 'Settings', assessorHidden: true },
  { slug: 'export', label: 'Export', assessorHidden: true },
  { slug: 'rubrics', label: 'Rubrics', assessorHidden: true },
];

export default function AssessmentLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const colors = useThemeColors();
  const pathname = usePathname();

  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  useEffect(() => setCurrentTryout(id), [id, setCurrentTryout]);

  // Real-time sync across every assessment screen, same as the app's tab navigator.
  useTryoutRealtimeSync(id);

  const tryoutQuery = useTryoutQuery(id);
  const terms = useTerms(tryoutQuery.data?.settings.customLabels);
  const regsQuery = useRegistrationsQuery(id);
  const pendingRegs = (regsQuery.data ?? []).filter((r) => r.status === 'pending').length;

  // See useIsAssessorOnly: the tryout's own `viewerIsOwner` decides, so
  // deleting `?assessor=1` from the URL can't bring Settings — and its Delete
  // button — back for an assessor, and carrying it can't take them away from
  // an owner. The parameter only dresses the first paint.
  const isAssessorOnly = useIsAssessorOnly(tryoutQuery.data?.viewerIsOwner);

  const segment = pathname.split('/')[3] ?? 'roster';
  const visibleTabs = TABS.filter((t) => !(isAssessorOnly && t.assessorHidden));
  const suffix = isAssessorOnly ? '?assessor=1' : '';

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard#evaluations"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: colors.inkMuted }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
          </svg>
          All evaluations
        </Link>
        <h1
          // Two lines on a phone, one ellipsised line from sm up: a 320px screen
          // cut names like "U15 AAA Fall Tryout 2026" down to nothing useful.
          className="line-clamp-2 text-2xl font-bold sm:truncate sm:text-3xl"
          style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
        >
          {tryoutQuery.data?.name ?? 'Loading…'}
        </h1>
        {tryoutQuery.data ? (
          <>
            <p className="mt-0.5 text-sm" style={{ color: colors.inkMuted }}>
              {sportLabel(tryoutQuery.data.sport, terms)} · {tryoutQuery.data.eventType}
              {tryoutQuery.data.tryoutDate ? ` · ${tryoutQuery.data.tryoutDate}` : ''}
              {tryoutQuery.data.startTime
                ? ` · ${tryoutQuery.data.startTime}${tryoutQuery.data.endTime ? `–${tryoutQuery.data.endTime}` : ''}`
                : ''}
              {tryoutQuery.data.rink ? (
                <>
                  {' · '}
                  <MapLink
                    location={tryoutQuery.data.rink}
                    label={tryoutQuery.data.name}
                    size="sm"
                    variant="inline"
                  />
                </>
              ) : null}
              {isAssessorOnly ? ' · Assessor mode' : ''}
            </p>
            {tryoutQuery.data.headCoach || tryoutQuery.data.assessors.length > 0 ? (
              <p className="mt-0.5 text-xs" style={{ color: colors.inkMuted }}>
                {tryoutQuery.data.headCoach ? `Coach: ${tryoutQuery.data.headCoach}` : ''}
                {tryoutQuery.data.headCoach && tryoutQuery.data.assessors.length > 0 ? ' · ' : ''}
                {tryoutQuery.data.assessors.length > 0
                  ? `Assessors: ${tryoutQuery.data.assessors.map((a) => a.name).join(', ')}`
                  : ''}
              </p>
            ) : null}
          </>
        ) : null}
      </div>

      {/* edge-bleed runs the strip to the screen edge so a half-visible tab
          reads as "scroll me" instead of as a clipped layout. */}
      <nav
        className="no-scrollbar edge-bleed mb-6 flex snap-x snap-proximity gap-1 overflow-x-auto border-b"
        style={{ borderColor: colors.border }}
      >
        {visibleTabs.map((tab) => {
          const active = segment === tab.slug || (tab.owns?.includes(segment) ?? false);
          return (
            <Link
              key={tab.slug}
              href={`/assessment/${id}/${tab.slug}${suffix}`}
              className="flex shrink-0 snap-start items-center gap-2 border-b-2 px-3.5 py-3 text-sm font-bold transition-colors"
              style={{
                borderColor: active ? colors.primary : 'transparent',
                color: active ? colors.primary : colors.inkMuted,
              }}
            >
              {tab.label}
              {tab.slug === 'registrations' && pendingRegs > 0 ? (
                <Badge label={pendingRegs} variant="brand" />
              ) : null}
            </Link>
          );
        })}
      </nav>

      {children}
    </>
  );
}
