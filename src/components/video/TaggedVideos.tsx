'use client';

import { useMemo, useState } from 'react';

import { useLibraryQuery, useSearchAthletesQuery } from '@/features/queries';
import { foldAthletes } from '@/data/duplicates';
import { useThemeColors } from '@/theme/ThemeProvider';


/** Who the report card is for, to find their other athlete records by name. */
export interface TaggedPerson {
  first: string;
  last: string;
}

/**
 * Every athlete record that is this same person. A player added to several
 * evaluations has several records, and a video can be tagged to any one of them,
 * so a report card looks for tags on all of them, not only on its own record.
 */
function useSamePersonIds(athleteId: string | undefined, person: TaggedPerson | undefined, needed: boolean): Set<string> {
  const same = useSearchAthletesQuery(needed && person ? `${person.first} ${person.last}` : '');
  return useMemo(() => {
    const ids = new Set<string>(athleteId ? [athleteId] : []);
    if (!athleteId) return ids;
    const group = foldAthletes(same.data ?? []).find((g) => g.id === athleteId || g.alsoIds.includes(athleteId));
    if (group) for (const id of [group.id, ...group.alsoIds]) ids.add(id);
    return ids;
  }, [athleteId, same.data]);
}

/** Library videos tagged to this player, on any of their athlete records. Hidden when there are none. */
export function TaggedVideos({ athleteId, person }: { athleteId: string | undefined; person?: TaggedPerson }) {
  const colors = useThemeColors();
  const library = useLibraryQuery({ enabled: !!athleteId });
  const [openId, setOpenId] = useState<string | null>(null);

  const tagged = (library.data ?? []).filter((i) => i.kind === 'video' && !!i.athleteId);
  // Only look for other records when a video is tagged to one that isn't this one.
  const ids = useSamePersonIds(athleteId, person, !!athleteId && tagged.some((i) => i.athleteId !== athleteId));
  const videos = tagged.filter((i) => ids.has(i.athleteId as string));
  if (!videos.length) return null;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        Videos tagged to this player
      </p>
      {videos.map((item) => {
        const stored = item.video?.url;
        const external = item.url && /^https?:\/\//i.test(item.url) ? item.url : null;
        return (
          <div key={item.id} className="rounded-xl border p-2.5" style={{ borderColor: colors.border }}>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color: colors.ink }}>
                {item.title}
              </span>
              {stored ? (
                <button
                  type="button"
                  onClick={() => setOpenId(openId === item.id ? null : item.id)}
                  className="rounded-lg border px-3 py-1.5 text-sm font-semibold"
                  style={{ borderColor: colors.primary, color: colors.primary }}
                >
                  {openId === item.id ? 'Hide' : 'Play'}
                </button>
              ) : external ? (
                <a
                  href={external}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg border px-3 py-1.5 text-sm font-semibold"
                  style={{ borderColor: colors.primary, color: colors.primary }}
                >
                  Open
                </a>
              ) : null}
            </div>
            {stored && openId === item.id ? (
              <video src={stored} controls playsInline controlsList="nodownload" className="mt-2 w-full rounded-lg bg-black" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
