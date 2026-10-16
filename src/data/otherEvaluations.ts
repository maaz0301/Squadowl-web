import { describeDuplicate, findPossibleDuplicates, type DuplicateReason } from '@/data/duplicates';

/**
 * Finding one player in the account's other evaluations, so their results can be
 * combined onto a single report card. Kept identical in both repos
 * (src/data/otherEvaluations.ts).
 *
 * The same player added to two evaluations is two roster rows, usually two
 * athlete records. A match on the athlete record is certain. A match on name
 * (the shared duplicate matcher in data/duplicates.ts) is certain when the name is
 * identical, and "uncertain" when it only looks alike, in which case the coach
 * is asked to confirm before the evaluation is combined.
 */

/** A roster row, in some other evaluation, that might be the player. */
export interface EvaluationCandidate {
  /** The roster row id, the one `PlayerFullResults.playerId` matches. */
  id: string;
  athleteId?: string;
  first: string;
  last: string;
  yob?: number | string | null;
  playerEmail?: string | null;
  tryoutId: string;
  tryoutName: string;
}

export interface PlayerRef {
  athleteIds: string[];
  first: string;
  last: string;
  yearOfBirth?: string | number | null;
  playerEmail?: string | null;
}

export interface EvaluationMatch {
  tryoutId: string;
  tryoutName: string;
  /** The player's roster row in that evaluation. */
  playerId: string;
  /** The name as it is spelled in that evaluation. */
  playerName: string;
  /** True when the coach should confirm it is the same athlete before combining. */
  uncertain: boolean;
  /** Why it matched, in words: 'same athlete record', 'has the same name', 'has a very similar name'... */
  why: string;
}

const STRENGTH: Record<string, number> = { athlete: 0, 'same-email': 1, 'same-name': 2, 'similar-name': 3 };

/** One best match per evaluation, certain ones first, then by evaluation name. */
export function matchPlayerAcrossEvaluations(who: PlayerRef, candidates: EvaluationCandidate[]): EvaluationMatch[] {
  const known = new Set(who.athleteIds);
  const best = new Map<string, { match: EvaluationMatch; rank: number }>();
  const consider = (c: EvaluationCandidate, kind: 'athlete' | DuplicateReason) => {
    const rank = STRENGTH[kind];
    const have = best.get(c.tryoutId);
    if (have && have.rank <= rank) return;
    best.set(c.tryoutId, {
      rank,
      match: {
        tryoutId: c.tryoutId,
        tryoutName: c.tryoutName,
        playerId: c.id,
        playerName: `${c.first} ${c.last}`.trim(),
        uncertain: kind === 'similar-name',
        why: kind === 'athlete' ? 'same athlete record' : describeDuplicate(kind),
      },
    });
  };

  const byName: EvaluationCandidate[] = [];
  for (const c of candidates) {
    if (c.athleteId && known.has(c.athleteId)) consider(c, 'athlete');
    else byName.push(c);
  }
  const found = findPossibleDuplicates(
    { first: who.first, last: who.last, yearOfBirth: who.yearOfBirth, playerEmail: who.playerEmail },
    byName.map((c) => ({ ...c, yearOfBirth: c.yob })),
  );
  for (const m of found) consider(m.player, m.reason);

  return [...best.values()]
    .sort((a, b) => Number(a.match.uncertain) - Number(b.match.uncertain) || a.match.tryoutName.localeCompare(b.match.tryoutName))
    .map((b) => b.match);
}

/**
 * The report card remembers which other evaluations were combined inside its
 * saved list of evaluation ids, as `x:<tryoutId>:<playerRowId>` markers, so no
 * new column is needed. Plain ids stay plain ids.
 */
const MARK = 'x:';

export function extraMarker(tryoutId: string, playerId: string): string {
  return `${MARK}${tryoutId}:${playerId}`;
}

export function splitSavedEvalIds(ids: string[]): { evalIds: string[]; extras: { tryoutId: string; playerId: string }[] } {
  const evalIds: string[] = [];
  const extras: { tryoutId: string; playerId: string }[] = [];
  for (const id of ids) {
    if (id.startsWith(MARK)) {
      const [tryoutId, playerId] = id.slice(MARK.length).split(':');
      if (tryoutId && playerId) extras.push({ tryoutId, playerId });
    } else evalIds.push(id);
  }
  return { evalIds, extras };
}
