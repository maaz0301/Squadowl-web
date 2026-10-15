/**
 * Spotting a player who is probably already on a roster, so a coach is asked
 * before a second copy is filed. Pure and shared by every place that adds
 * players: the add form, the registration queue and the spreadsheet import.
 */

export interface DuplicateCandidate {
  first: string;
  last: string;
  yearOfBirth?: string | number | null;
  playerEmail?: string | null;
  guardianEmail?: string | null;
}

export type DuplicateReason = 'same-email' | 'same-name' | 'similar-name';

export interface DuplicateMatch<T extends DuplicateCandidate = DuplicateCandidate> {
  player: T;
  reason: DuplicateReason;
}

const norm = (v: string | number | null | undefined) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@.+_\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const fullName = (p: DuplicateCandidate) => norm(`${p.first} ${p.last}`);

/** Edit distance, stopping early once it passes `limit`. */
function distance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      best = Math.min(best, row[j]);
    }
    if (best > limit) return limit + 1;
    prev = row;
  }
  return prev[b.length];
}

/** Birth years that are both known and different rule two people apart; a missing one rules nothing out. */
function birthYearsAgree(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  const ya = norm(a.yearOfBirth);
  const yb = norm(b.yearOfBirth);
  return !ya || !yb || ya === yb;
}

export function describeDuplicate(reason: DuplicateReason): string {
  if (reason === 'same-email') return 'uses the same email address';
  if (reason === 'same-name') return 'has the same name';
  return 'has a very similar name';
}

/** How strongly a match should be taken, strongest first when sorting. */
const RANK: Record<DuplicateReason, number> = { 'same-email': 0, 'same-name': 1, 'similar-name': 2 };

/**
 * The roster players that `candidate` may be a second copy of.
 *
 * - the same player email, always;
 * - the same name (in either order) unless the birth years differ;
 * - a name one or two typos away when the birth years do not differ.
 *
 * Siblings share a guardian email, so a guardian email on its own never
 * counts.
 */
export function findPossibleDuplicates<T extends DuplicateCandidate>(candidate: DuplicateCandidate, roster: T[]): DuplicateMatch<T>[] {
  const name = fullName(candidate);
  const swapped = norm(`${candidate.last} ${candidate.first}`);
  const email = norm(candidate.playerEmail);
  const matches: DuplicateMatch<T>[] = [];
  for (const player of roster) {
    if (email && email === norm(player.playerEmail)) {
      matches.push({ player, reason: 'same-email' });
      continue;
    }
    if (!name || !birthYearsAgree(candidate, player)) continue;
    const other = fullName(player);
    if (!other) continue;
    if (other === name || other === swapped) {
      matches.push({ player, reason: 'same-name' });
      continue;
    }
    const limit = name.length >= 9 ? 2 : 1;
    if (name.length >= 5 && distance(name, other, limit) <= limit) {
      matches.push({ player, reason: 'similar-name' });
    }
  }
  return matches.sort((a, b) => RANK[a.reason] - RANK[b.reason]);
}

/** One line for a confirmation or banner: 'Jane Doe (#12) has the same name.' */
export function duplicateSummary(match: DuplicateMatch & { player: DuplicateCandidate & { jersey?: string | null } }): string {
  const { player } = match;
  const jersey = player.jersey ? ` (#${player.jersey})` : '';
  return `${`${player.first} ${player.last}`.trim()}${jersey} ${describeDuplicate(match.reason)}.`;
}

/** The text for the "add anyway?" prompt, or '' when nothing matched. */
export function duplicatePrompt(matches: DuplicateMatch[], who: string): string {
  if (matches.length === 0) return '';
  const lines = matches.slice(0, 3).map((m) => `- ${duplicateSummary(m)}`);
  const more = matches.length > 3 ? `\n- and ${matches.length - 3} more` : '';
  return `${who} may already be on this roster:\n${lines.join('\n')}${more}\n\nAdd them anyway?`;
}

export interface RegistrationCandidate extends DuplicateCandidate {
  id: string;
  status?: string;
}

/** The player-shaped view of a registration, which names its fields firstName and lastName. */
export function registrationAsCandidate(r: {
  firstName: string;
  lastName: string;
  yearOfBirth?: string | null;
  playerEmail?: string | null;
  guardianEmail?: string | null;
}): DuplicateCandidate {
  return { first: r.firstName, last: r.lastName, yearOfBirth: r.yearOfBirth, playerEmail: r.playerEmail, guardianEmail: r.guardianEmail };
}

/**
 * For each pending registration that looks like someone already on `roster`, or
 * like another registration in the same queue, a sentence saying who. A
 * registration never flags itself, and of two matching pending ones only the
 * later is flagged, so the first can be added without a prompt.
 */
export function flagRegistrationDuplicates<R extends { id: string; status?: string; firstName: string; lastName: string; yearOfBirth?: string | null; playerEmail?: string | null; guardianEmail?: string | null }>(
  registrations: R[],
  roster: (DuplicateCandidate & { jersey?: string | null })[],
): Map<string, string> {
  const flags = new Map<string, string>();
  const seen: (DuplicateCandidate & { jersey?: string | null })[] = [];
  for (const r of registrations) {
    if (r.status === 'dismissed') continue;
    const cand = registrationAsCandidate(r);
    const onRoster = findPossibleDuplicates(cand, roster);
    if (r.status === 'pending') {
      if (onRoster.length > 0) flags.set(r.id, `Already on the roster? ${duplicateSummary(onRoster[0])}`);
      else {
        const inQueue = findPossibleDuplicates(cand, seen);
        if (inQueue.length > 0) flags.set(r.id, `Registered twice? ${duplicateSummary(inQueue[0])}`);
      }
    }
    seen.push(cand);
  }
  return flags;
}

/** What folding needs to know about an athlete record. */
export interface FoldableAthlete {
  id: string;
  first: string;
  last: string;
  yearOfBirth?: string | null;
  avatarUrl?: string;
  guardianName?: string;
  guardianEmail?: string;
  playerEmail?: string;
  currentPosition?: string;
}

/**
 * One entry per person in a list of athlete records. Adding the same player to
 * several evaluations files a new athlete record each time, so a search for one
 * name came back as the same person six times, each holding a different slice
 * of their results. Records with the same name (either order) are one person
 * unless both carry a birth year and the years differ. The fullest record leads;
 * the rest ride along in `alsoIds` so the profile can bring all their results
 * together.
 */
export function foldAthletes<T extends FoldableAthlete>(rows: T[]): (T & { alsoIds: string[] })[] {
  const richness = (a: T) =>
    [a.avatarUrl, a.guardianName, a.guardianEmail, a.playerEmail, a.currentPosition, a.yearOfBirth].filter(Boolean).length;

  interface Cluster {
    yob: string;
    members: T[];
  }
  const byName = new Map<string, Cluster[]>();
  const order: Cluster[] = [];

  for (const row of rows) {
    const nameKey = norm(`${row.first} ${row.last}`).split(' ').filter(Boolean).sort().join(' ');
    const yob = norm(row.yearOfBirth);
    const clusters = byName.get(nameKey) ?? [];
    // A known year only joins a cluster of the same year (or one that has none yet); an unknown one joins the first.
    let home = clusters.find((c) => !yob || !c.yob || c.yob === yob);
    if (!home) {
      home = { yob: '', members: [] };
      clusters.push(home);
      order.push(home);
      byName.set(nameKey, clusters);
    }
    if (!home.yob && yob) home.yob = yob;
    if (!home.members.some((m) => m.id === row.id)) home.members.push(row);
  }

  return order.map(({ members }) => {
    const lead = members.reduce((best, m) => (richness(m) > richness(best) ? m : best), members[0]);
    return { ...lead, alsoIds: members.filter((m) => m.id !== lead.id).map((m) => m.id) };
  });
}
