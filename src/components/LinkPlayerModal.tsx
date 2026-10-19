'use client';

import { useEffect, useMemo, useState } from 'react';

import { Avatar, Badge, Button, Input, Modal } from '@/components/ui';
import { foldAthletes } from '@/data/duplicates';
import { playerDisplayName } from '@/data/rubrics';
import { useAthleteHubQuery, useAthleteLinksQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * Pick players already in the account (from other teams, seasons and
 * evaluations) to link to this team or evaluation. A linked player is the same
 * person, not a copy: their profile and full history show everywhere they are linked.
 */
export function LinkPlayerModal({
  visible,
  title = 'Link Player',
  where,
  linkedAthleteIds,
  linking,
  onClose,
  onLink,
}: {
  visible: boolean;
  title?: string;
  /** Names the destination in messages: "this team", "this evaluation". */
  where: string;
  /** Athlete ids already linked here. */
  linkedAthleteIds: ReadonlySet<string>;
  linking: boolean;
  onClose: () => void;
  onLink: (athleteIds: string[]) => void;
}) {
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);
  // Start fresh each time it opens: reset while rendering, the supported way to adjust state when a prop changes.
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible) {
      setQuery('');
      setSearch('');
      setSelected(new Set());
      setNotice(null);
    }
  }

  const hubQuery = useAthleteHubQuery(search);
  const athletes = useMemo(() => foldAthletes(hubQuery.data?.pages.flatMap((p) => p.rows) ?? []), [hubQuery.data]);
  const linksQuery = useAthleteLinksQuery(athletes.flatMap((a) => [a.id, ...a.alsoIds]));

  const isLinked = (a: { id: string; alsoIds: string[] }) =>
    linkedAthleteIds.has(a.id) || a.alsoIds.some((id) => linkedAthleteIds.has(id));

  const toggle = (a: (typeof athletes)[number]) => {
    if (isLinked(a)) {
      setNotice(`${playerDisplayName(a)} is already linked to ${where}.`);
      return;
    }
    setNotice(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(a.id)) next.delete(a.id);
      else next.add(a.id);
      return next;
    });
  };

  return (
    <Modal
      visible={visible}
      title={title}
      onClose={onClose}
      hideDefaultFooter
      footer={
        <div className="flex w-full justify-end gap-2">
          <Button label="Cancel" variant="secondary" onClick={onClose} />
          <Button
            label={selected.size > 0 ? `Link ${selected.size} player${selected.size === 1 ? '' : 's'}` : 'Select players to link'}
            disabled={selected.size === 0}
            loading={linking}
            onClick={() => onLink([...selected])}
          />
        </div>
      }
    >
      <p className="mb-2 text-sm" style={{ color: colors.inkMuted }}>
        Pick players from your other teams and evaluations. They stay one player with one history.
      </p>
      <Input
        placeholder="Search by name or guardian"
        aria-label="Search players to link"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {notice ? (
        <p className="mt-2 text-sm font-bold" role="status" style={{ color: colors.warning }}>
          {notice}
        </p>
      ) : null}
      <div className="mt-2 max-h-[50vh] overflow-y-auto">
        {hubQuery.isLoading ? (
          <p className="py-6 text-center text-sm" style={{ color: colors.inkMuted }}>
            Loading players…
          </p>
        ) : athletes.length === 0 ? (
          <p className="py-6 text-center text-sm" style={{ color: colors.inkMuted }}>
            {search ? 'No players match that search.' : 'No other players to link yet.'}
          </p>
        ) : (
          athletes.map((a) => {
            const linked = isLinked(a);
            const on = selected.has(a.id);
            const teamNames = [
              ...new Set([a.id, ...a.alsoIds].flatMap((id) => linksQuery.data?.[id]?.teams ?? []).map((t) => t.name)),
            ];
            return (
              <button
                key={a.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggle(a)}
                className="flex w-full items-center gap-3 border-b py-2 text-left"
                style={{ borderColor: colors.border, opacity: linked ? 0.55 : 1 }}
              >
                <span
                  aria-hidden
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border text-xs font-bold text-white"
                  style={{
                    borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primary : 'transparent',
                  }}
                >
                  {on ? '✓' : ''}
                </span>
                <Avatar first={a.first} last={a.last} pos={a.currentPosition} size={36} uri={a.avatarUrl} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-bold" style={{ color: colors.ink }}>
                    {playerDisplayName(a)}
                  </span>
                  <span className="block truncate text-xs" style={{ color: colors.inkMuted }}>
                    {[a.yearOfBirth, a.currentPosition, teamNames.length ? `On ${teamNames.join(', ')}` : '']
                      .filter(Boolean)
                      .join(' · ') || 'Player'}
                  </span>
                </span>
                {linked ? <Badge label="Linked" /> : null}
              </button>
            );
          })
        )}
        {hubQuery.hasNextPage ? (
          <div className="flex justify-center py-3">
            <Button
              label="Load more"
              variant="secondary"
              size="sm"
              loading={hubQuery.isFetchingNextPage}
              onClick={() => hubQuery.fetchNextPage()}
            />
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
