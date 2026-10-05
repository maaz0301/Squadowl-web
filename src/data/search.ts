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
  /** The person behind the roster row. The same athlete on two evaluations has two roster rows but one of these. */
  athleteId?: string;
  first: string;
  last: string;
  /** Year of birth, used only to tell apart two different people who share a name. */
  yob?: number;
  jersey?: string;
  pos?: string;
  tryoutId: string;
  tryoutName: string;
}

/**
 * One person in the results, however many evaluations they are on. A player
 * evaluated three times used to come back as three identical-looking rows;
 * this folds them into one that lists every evaluation, and opens the player's
 * profile, which already connects all of them.
 */
export interface SearchPerson {
  /** Stable key for lists: the athlete id, or a name-based key when there isn't one. */
  key: string;
  athleteId?: string;
  first: string;
  last: string;
  /** The first evaluation seen, for the jersey and position shown on the row. */
  jersey?: string;
  pos?: string;
  /** Every evaluation this person appears on. Never empty. */
  evaluations: SearchPlayer[];
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
  players: Entry<SearchPerson>[];
  seasons: Entry<SearchSeason>[];
}

export interface SearchGroup<T> {
  items: T[];
  /** How many matched in total, including the ones cut off by the cap. */
  total: number;
}

export interface SearchOutcome {
  evaluations: SearchGroup<SearchEvaluation>;
  players: SearchGroup<SearchPerson>;
  seasons: SearchGroup<SearchSeason>;
}

/**
 * Folds roster rows into people. Rows sharing an athlete id are one person.
 * Rows with different athlete ids still merge when they carry the same name and
 * the same year of birth, because an athlete imported separately into two
 * evaluations gets two athlete records; without a year of birth to confirm it,
 * two same-named players are left apart rather than wrongly merged.
 */
export function groupPlayers(rows: SearchPlayer[]): SearchPerson[] {
  const people = new Map<string, SearchPerson>();
  const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, ' ');

  for (const row of rows) {
    const nameKey = `${norm(row.first)}|${norm(row.last)}`;
    const key = row.athleteId
      ? `a:${row.athleteId}`
      : row.yob
        ? `n:${nameKey}|${row.yob}`
        : `r:${row.id}`;
    // The same name and birth year under a second athlete id is the same person.
    const mergeKey = row.yob ? `n:${nameKey}|${row.yob}` : key;

    let person = people.get(key) ?? people.get(mergeKey);
    if (!person) {
      person = {
        key,
        athleteId: row.athleteId,
        first: row.first,
        last: row.last,
        jersey: row.jersey,
        pos: row.pos,
        evaluations: [],
      };
      people.set(key, person);
      if (mergeKey !== key) people.set(mergeKey, person);
    } else if (!people.has(key)) {
      people.set(key, person);
    }
    person.evaluations.push(row);
  }
  return Array.from(new Set(people.values()));
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
    players: groupPlayers(input.players ?? []).map((item) => ({
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
      (e) => hasAll(e.text) || (jersey !== '' && e.item.evaluations.some((p) => p.jersey === jersey)),
      limit,
    ),
    seasons: collect(index.seasons, (e) => hasAll(e.text), limit),
  };
}
