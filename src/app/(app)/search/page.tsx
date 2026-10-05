'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import Link from 'next/link';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Card, EmptyState, Input, PageHeader, Spinner } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icons';
import { NavPending } from '@/components/NavPending';
import { useSearchPlayersQuery, useSeasonsQuery, useTryoutSummariesQuery } from '@/features/queries';
import { buildSearchIndex, runSearch } from '@/data/search';
import { prefetchTryout } from '@/features/prefetch';
import { useSessionStore } from '@/state/sessionStore';

const PAGE = 25;

function Row({
  href,
  icon,
  title,
  sub,
  onOpen,
  onWarm,
}: {
  href: string;
  icon: IconName;
  title: string;
  sub?: string;
  onOpen?: () => void;
  onWarm?: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Link href={href} className="block" onClick={onOpen} onMouseEnter={onWarm} onTouchStart={onWarm}>
      <Card interactive className="flex items-center gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: 'rgba(255,107,43,0.12)' }}
        >
          <Icon name={icon} size={20} color={colors.primary} />
        </span>
        <span className="min-w-0 flex-1">
          <span
            className="block truncate text-base font-bold"
            style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
          >
            {title}
          </span>
          {sub ? (
            <span className="block truncate text-sm" style={{ color: colors.inkMuted }}>
              {sub}
            </span>
          ) : null}
        </span>
        <NavPending />
        <Icon name="chevronRight" size={16} color={colors.inkMuted} strokeWidth={2.5} />
      </Card>
    </Link>
  );
}

function Heading({ label, count }: { label: string; count: number }) {
  const colors = useThemeColors();
  return (
    <h2 className="mt-4 mb-2 text-xs font-bold tracking-wider uppercase" style={{ color: colors.inkMuted }}>
      {label} · {count}
    </h2>
  );
}

export default function SearchPage() {
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const setCurrentTryout = useSessionStore((s) => s.setCurrentTryout);

  // Three independent reads, none of them blocking the page. Evaluation names
  // come from the light list the dashboard has usually cached already, players
  // from a names-only read (no scores — the full evaluations read this page used
  // to wait on took most of a minute on a large account), seasons whenever they
  // land. The box is usable at once and each group fills in as it arrives.
  const evaluationsQuery = useTryoutSummariesQuery(false);
  const playersQuery = useSearchPlayersQuery();
  const seasonsQuery = useSeasonsQuery();

  // Built once per data change, so a keystroke only does substring tests.
  const index = useMemo(
    () =>
      buildSearchIndex({
        evaluations: (evaluationsQuery.data ?? []).map((t) => ({ id: t.id, name: t.name, sport: t.sport })),
        players: playersQuery.data,
        seasons: (seasonsQuery.data ?? []).map((s) => ({ id: s.id, name: s.name, teamName: s.teamName })),
      }),
    [evaluationsQuery.data, playersQuery.data, seasonsQuery.data],
  );

  // The input stays instant; results follow on a deferred copy.
  const deferredQuery = useDeferredValue(query);
  const outcome = useMemo(() => runSearch(index, deferredQuery, limit), [index, deferredQuery, limit]);

  const hasQuery = deferredQuery.trim().length > 0;
  const stillLoading = evaluationsQuery.isLoading || playersQuery.isLoading || seasonsQuery.isLoading;
  const failed = evaluationsQuery.isError || playersQuery.isError;
  const total = outcome.evaluations.total + outcome.players.total + outcome.seasons.total;
  const shown = outcome.evaluations.items.length + outcome.players.items.length + outcome.seasons.items.length;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Search" showBack />

      <div className="relative">
        <Input
          label="Search evaluations, players, seasons"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          placeholder="Tryout name, player, jersey #, team..."
          autoFocus
          autoComplete="off"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => setQuery('')}
            className="absolute right-3 bottom-3 flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:brightness-125"
            style={{ backgroundColor: colors.tile }}
          >
            <Icon name="close" size={16} color={colors.inkMuted} />
          </button>
        ) : null}
      </div>

      {stillLoading ? (
        <p className="mt-3 flex items-center gap-2 text-xs" style={{ color: colors.inkMuted }} role="status">
          <Spinner size={14} color={colors.primary} />
          Loading {playersQuery.isLoading ? 'players' : 'results'}… results appear as they load.
        </p>
      ) : null}
      {failed ? (
        <p className="mt-3 flex items-center gap-2 text-xs" style={{ color: colors.warning }} role="alert">
          Some results couldn&apos;t be loaded.
          <button
            type="button"
            className="font-bold"
            style={{ color: colors.primary }}
            onClick={() => {
              evaluationsQuery.refetch();
              playersQuery.refetch();
              seasonsQuery.refetch();
            }}
          >
            Retry
          </button>
        </p>
      ) : null}

      <div className="mt-2" aria-live="polite">
        {!hasQuery ? (
          <EmptyState
            title="Start typing"
            message="Search across evaluations, players, jersey numbers and seasons."
          />
        ) : total === 0 && !stillLoading ? (
          <EmptyState title="No results" message={`Nothing matched "${deferredQuery.trim()}".`} />
        ) : (
          <div className="flex flex-col gap-2">
            {outcome.evaluations.items.length ? <Heading label="Evaluations" count={outcome.evaluations.total} /> : null}
            {outcome.evaluations.items.map((e) => (
              <Row
                key={`e-${e.id}`}
                href={`/assessment/${e.id}/roster`}
                icon="assessments"
                title={e.name}
                sub={e.sport}
                onOpen={() => setCurrentTryout(e.id)}
                onWarm={() => prefetchTryout(e.id)}
              />
            ))}

            {outcome.players.items.length ? <Heading label="Players" count={outcome.players.total} /> : null}
            {outcome.players.items.map((p) => {
              const first = p.evaluations[0];
              const many = p.evaluations.length > 1 && !!p.athleteId;
              const names = Array.from(new Set(p.evaluations.map((e) => e.tryoutName).filter(Boolean)));
              return (
                <Row
                  key={`p-${p.key}`}
                  // One person on several evaluations opens their profile, which
                  // lines every evaluation up together; a single one still goes
                  // straight to that evaluation's player screen.
                  href={many ? `/player/${p.athleteId}` : `/assessment/${first.tryoutId}/player/${first.id}`}
                  icon="profile"
                  title={`${p.first} ${p.last}`.trim()}
                  sub={
                    many
                      ? `${p.evaluations.length} evaluations${names.length ? ` · ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}` : ''}`
                      : [p.jersey ? `#${p.jersey}` : null, p.pos, first.tryoutName].filter(Boolean).join(' · ')
                  }
                  onOpen={() => setCurrentTryout(first.tryoutId)}
                  onWarm={() => prefetchTryout(first.tryoutId)}
                />
              );
            })}

            {outcome.seasons.items.length ? <Heading label="Seasons" count={outcome.seasons.total} /> : null}
            {outcome.seasons.items.map((s) => (
              <Row key={`s-${s.id}`} href={`/season/${s.id}`} icon="calendar" title={s.name} sub={s.teamName} />
            ))}

            {total > shown ? (
              <button
                type="button"
                onClick={() => setLimit((l) => l + 100)}
                className="py-3 text-sm font-bold"
                style={{ color: colors.primary }}
              >
                Show {Math.min(total - shown, 100)} more ({total - shown} left)
              </button>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
