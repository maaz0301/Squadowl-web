'use client';

import { use, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { useSeasonQuery, useSeasonRealtimeSync } from '@/features/queries';
import { ChatUnreadBadge } from '@/components/ChatUnreadBadge';

const TABS = [
  { slug: '', label: 'Hub' },
  { slug: 'schedule', label: 'Schedule' },
  { slug: 'calendar', label: 'Calendar' },
  { slug: 'roster', label: 'Roster' },
  { slug: 'attendance', label: 'Attendance' },
  { slug: 'availability', label: 'Availability' },
  { slug: 'chat', label: 'Chat' },
  { slug: 'settings', label: 'Settings' },
];

export default function SeasonLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const colors = useThemeColors();
  const pathname = usePathname();
  const seasonQuery = useSeasonQuery(id);
  // Live-refresh every season tab below when an event is edited or a guardian
  // RSVPs, rather than waiting for the coach to reload.
  useSeasonRealtimeSync(id);

  const segment = pathname.split('/')[3] ?? '';

  return (
    <>
      <div className="mb-4">
        <Link
          href="/seasons"
          className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold"
          style={{ color: colors.inkMuted }}
        >
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
            <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
          </svg>
          All seasons
        </Link>
        <h1
          // Two lines on a phone, one ellipsised line from sm up: a 320px screen
          // cut names like "U15 AAA Fall Tryout 2026" down to nothing useful.
          className="line-clamp-2 text-2xl font-bold sm:truncate sm:text-3xl"
          style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
        >
          {seasonQuery.data?.name ?? 'Loading…'}
        </h1>
        {seasonQuery.data ? (
          <p className="mt-0.5 text-sm" style={{ color: colors.inkMuted }}>
            {seasonQuery.data.teamName} · {seasonQuery.data.sport}
            {seasonQuery.data.year ? ` · ${seasonQuery.data.year}` : ''}
          </p>
        ) : null}
      </div>

      {/* Matches the assessment tab strip: bleeds to the screen edge on phones
          so the next tab peeks in rather than being clipped by the gutter. */}
      <nav
        className="no-scrollbar edge-bleed mb-6 flex snap-x snap-proximity gap-1 overflow-x-auto border-b"
        style={{ borderColor: colors.border }}
      >
        {TABS.map((tab) => {
          const active = segment === tab.slug || (tab.slug === '' && segment === '');
          return (
            <Link
              key={tab.slug || 'hub'}
              href={`/season/${id}${tab.slug ? `/${tab.slug}` : ''}`}
              className="inline-flex shrink-0 snap-start items-center gap-1.5 border-b-2 px-3.5 py-3 text-sm font-bold transition-colors"
              style={{
                borderColor: active ? colors.primary : 'transparent',
                color: active ? colors.primary : colors.inkMuted,
              }}
            >
              {tab.label}
              {tab.slug === 'chat' ? <ChatUnreadBadge seasonId={id} /> : null}
            </Link>
          );
        })}
      </nav>

      {children}
    </>
  );
}
