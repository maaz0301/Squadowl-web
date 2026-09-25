/**
 * Global search, split so typing stays cheap.
 *
 * `buildSearchIndex` lower-cases every searchable string once, when the data
 * arrives; `runSearch` then only does substring tests on those strings, so a
 * keystroke costs one pass over ready-made text instead of re-deriving names
 * from every roster. Results are capped per group — a broad query on a
 * thousand-player account would otherwise mount thousands of rows.
 */

export interface SearchPlayer {
  /** The roster row id — the one the player screens open by. */
  id: string;
  first: string;
  last: string;
  jersey?: string;
  pos?: string;
  tryoutId: string;
  tryoutName: string;
}

export interface SearchEvaluation {
  id: string;
  name: string;
  sport: string;
  archived?: boolean;
}

export interface SearchSeason {
  id: string;
  name: string;
  teamName: string;
}

interface Entry<T> {
  item: T;
  /** Lower-cased text the query is matched against. */
  text: string;
}

export interface SearchIndex {
  evaluations: Entry<SearchEvaluation>[];
  players: Entry<SearchPlayer>[];
  seasons: Entry<SearchSeason>[];
}

export interface SearchGroup<T> {
  items: T[];
  /** How many matched in total, including the ones cut off by the cap. */
  total: number;
}

export interface SearchOutcome {
  evaluations: SearchGroup<SearchEvaluation>;
  players: SearchGroup<SearchPlayer>;
  seasons: SearchGroup<SearchSeason>;
}

export function buildSearchIndex(input: {
  evaluations?: SearchEvaluation[];
  players?: SearchPlayer[];
  seasons?: SearchSeason[];
}): SearchIndex {
  return {
    evaluations: (input.evaluations ?? [])
      .filter((e) => !e.archived)
      .map((item) => ({ item, text: item.name.toLowerCase() })),
    players: (input.players ?? []).map((item) => ({
      item,
      // First-last and last-first both match, so "doe jane" finds Jane Doe.
      // The jersey number is separated so "7" doesn't match every "17" by name.
      text: `${item.first} ${item.last} ${item.last} ${item.first}`.toLowerCase(),
    })),
    seasons: (input.seasons ?? []).map((item) => ({
      item,
      text: `${item.name} ${item.teamName}`.toLowerCase(),
    })),
  };
}

function collect<T>(entries: Entry<T>[], match: (e: Entry<T>) => boolean, limit: number): SearchGroup<T> {
  const items: T[] = [];
  let total = 0;
  for (const e of entries) {
    if (!match(e)) continue;
    total += 1;
    if (items.length < limit) items.push(e.item);
  }
  return { items, total };
}

export const EMPTY_SEARCH: SearchOutcome = {
  evaluations: { items: [], total: 0 },
  players: { items: [], total: 0 },
  seasons: { items: [], total: 0 },
};

/** Every word of the query must appear somewhere in the text, in any order. */
export function runSearch(index: SearchIndex, rawQuery: string, limit = 25): SearchOutcome {
  const words = rawQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return EMPTY_SEARCH;

  const hasAll = (text: string) => words.every((w) => text.includes(w));
  const jersey = words.length === 1 ? words[0].replace(/^#/, '') : '';

  return {
    evaluations: collect(index.evaluations, (e) => hasAll(e.text), limit),
    players: collect(
      index.players,
      (e) => hasAll(e.text) || (jersey !== '' && e.item.jersey === jersey),
      limit,
    ),
    seasons: collect(index.seasons, (e) => hasAll(e.text), limit),
  };
}
