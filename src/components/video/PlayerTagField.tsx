'use client';

import { useEffect, useState } from 'react';

import { Button, FieldShell, Input } from '@/components/ui';
import { useSearchAthletesQuery } from '@/features/queries';
import { foldAthletes } from '@/data/duplicates';
import type { Athlete } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

const MAX_RESULTS = 6;

/**
 * Tags a video (or any Library item) with a player. Searches the players in the
 * coach's teams and evaluations; the tagged item also shows on that player's
 * report card screen. Optional, so it starts empty.
 */
export function PlayerTagField({ value, onChange }: { value: string | null; onChange: (athleteId: string | null) => void }) {
  const colors = useThemeColors();
  const [query, setQuery] = useState('');
  // An account can hold tens of thousands of athletes, so matches come from a server
  // search, asked only once typing pauses.
  const [term, setTerm] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setTerm(query), 250);
    return () => clearTimeout(t);
  }, [query]);
  const search = useSearchAthletesQuery(term);
  const [chosen, setChosen] = useState<Athlete | null>(null);

  const typed = query.trim().length >= 2;
  // One entry per person: a player on several evaluations has several athlete records.
  const matches = typed ? foldAthletes(search.data ?? []).slice(0, MAX_RESULTS) : [];
  const searching = typed && (term !== query || search.isFetching);
  const shown = chosen && chosen.id === value ? chosen : null;

  return (
    <FieldShell label="Tag a player (optional)" hint="The video also appears on this player's report card.">
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: colors.primary }}>
          <span className="min-w-0 flex-1 truncate font-bold" style={{ color: colors.ink }}>
            {shown ? `${shown.first} ${shown.last}` : 'Tagged player'}
            {shown?.currentTeam ? (
              <span className="ml-2 font-normal" style={{ color: colors.inkMuted }}>
                {shown.currentTeam}
              </span>
            ) : null}
          </span>
          <Button size="sm" variant="ghost" label="Remove" onClick={() => onChange(null)} />
        </div>
      ) : (
        <>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players by name"
            autoComplete="off"
          />
          {query.trim() && !typed ? (
            <span className="text-xs" style={{ color: colors.inkMuted }}>
              Type at least 2 letters.
            </span>
          ) : null}
          {typed && !matches.length ? (
            <span className="text-xs" style={{ color: colors.inkMuted }}>
              {searching ? 'Searching...' : search.isError ? 'Could not search players. Try again.' : 'No players match.'}
            </span>
          ) : null}
          {matches.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setChosen(a);
                onChange(a.id);
                setQuery('');
                setTerm('');
              }}
              className="flex flex-col rounded-xl border px-3 py-2 text-left transition-[filter] hover:brightness-110"
              style={{ borderColor: colors.border, backgroundColor: colors.tile }}
            >
              <span className="font-bold" style={{ color: colors.ink }}>
                {a.first} {a.last}
              </span>
              <span className="text-xs" style={{ color: colors.inkMuted }}>
                {[a.currentTeam, a.jersey ? `#${a.jersey}` : '', a.yearOfBirth].filter(Boolean).join(' · ') || 'No team yet'}
              </span>
            </button>
          ))}
        </>
      )}
    </FieldShell>
  );
}
