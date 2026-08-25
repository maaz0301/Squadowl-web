'use client';

import { use, useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge } from '@/components/ui';
import { useRegistrationsQuery, useTryoutQuery, useTryoutRealtimeSync } from '@/features/queries';
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
    owns: ['player', 'score', 'rinkside', 'team-builder', 'compare', 'roster-library', 'scan-sheet'],
  },
  { slug: 'registrations', label: 'Registrations', assessorHidden: true },
  { slug: 'results', label: 'Results' },
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
  const searchParams = useSearchParams();
  const isAssessorOnly = searchParams.get('assessor') === '1';

  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);
  useEffect(() => setCurrentTryout(id), [id, setCurrentTryout]);

  // Real-time sync across every assessment screen, same as the app's tab navigator.
  useTryoutRealtimeSync(id);

  const tryoutQuery = useTryoutQuery(id);
  const regsQuery = useRegistrationsQuery(id);
  const pendingRegs = (regsQuery.data ?? []).filter((r) => r.status === 'pending').length;

  const segment = pathname.split('/')[3] ?? 'roster';
  const visibleTabs = TABS.filter((t) => !(isAssessorOnly && t.assessorHidden));
  const suffix = isAssessorOnly ? '?assessor=1' : '';

  return (
    <>
      <div className="mb-4">
        <Link
          href="/dashboard"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: colors.inkMuted }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
          </svg>
          All assessments
        </Link>
        <h1
          className="truncate text-2xl font-bold sm:text-3xl"
          style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
        >
          {tryoutQuery.data?.name ?? 'Loading…'}
        </h1>
        {tryoutQuery.data ? (
          <p className="mt-0.5 text-sm" style={{ color: colors.inkMuted }}>
            {tryoutQuery.data.sport} · {tryoutQuery.data.eventType}
            {tryoutQuery.data.tryoutDate ? ` · ${tryoutQuery.data.tryoutDate}` : ''}
            {isAssessorOnly ? ' · Assessor mode' : ''}
          </p>
        ) : null}
      </div>

      <nav
        className="no-scrollbar mb-6 flex gap-1 overflow-x-auto border-b"
        style={{ borderColor: colors.border }}
      >
        {visibleTabs.map((tab) => {
          const active = segment === tab.slug || (tab.owns?.includes(segment) ?? false);
          return (
            <Link
              key={tab.slug}
              href={`/assessment/${id}/${tab.slug}${suffix}`}
              className="flex shrink-0 items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-bold transition-colors"
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
