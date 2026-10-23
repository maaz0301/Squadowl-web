/**
 * Column layout for the Compare PDF. The page keeps a fixed landscape size and the
 * text keeps a readable size; a table with more rubric columns than fit is split into
 * bands of columns, one band after another, with the columns that identify a player
 * (rank, name, evaluation, overall) repeated on every page. Kept identical in both repos.
 */

export interface CompareBandPlan {
  /** How many score columns each band carries, in order. Always sums to scoreCount. */
  bands: number[];
}

export function planCompareBands(opts: {
  /** Usable width of the page, margins excluded. */
  available: number;
  /** Width of every identity column on the first band (rank, name, team, birth date, evaluation, date, overall). */
  firstFixed: number;
  /** Width of the columns repeated on the later bands (rank, name, evaluation, overall). */
  repeatFixed: number;
  /** Width of one score column. */
  scoreWidth: number;
  scoreCount: number;
}): CompareBandPlan {
  const { available, firstFixed, repeatFixed, scoreWidth, scoreCount } = opts;
  if (scoreCount <= 0) return { bands: [0] };
  const fit = (fixed: number) => Math.max(0, Math.floor((available - fixed) / scoreWidth));
  const first = fit(firstFixed);
  // A later band always carries at least one score column, or it would never end.
  const later = Math.max(1, fit(repeatFixed));
  const bands: number[] = [];
  let left = scoreCount;
  const firstTake = Math.min(first, left);
  bands.push(firstTake);
  left -= firstTake;
  while (left > 0) {
    const take = Math.min(later, left);
    bands.push(take);
    left -= take;
  }
  return { bands };
}

/**
 * Splits a header into at most `maxLines` lines no wider than `width`, breaking at spaces.
 * A word wider than the line, or text past the last line, is cut with "...".
 */
export function wrapHeader(
  text: string,
  width: number,
  maxLines: number,
  measure: (text: string) => number,
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  const cut = (s: string) => {
    let out = s;
    while (out.length > 1 && measure(out + '...') > width) out = out.slice(0, -1);
    return out + '...';
  };
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = measure(word) <= width ? word : cut(word);
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && (words.join(' ') !== lines.join(' '))) {
    lines[maxLines - 1] = measure(lines[maxLines - 1] + '...') <= width ? lines[maxLines - 1] + '...' : cut(lines[maxLines - 1]);
  }
  return lines.length ? lines : [''];
}
