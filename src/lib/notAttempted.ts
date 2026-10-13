/**
 * "Did not attempt", saved per test. A skater who skipped a test has no result for it, and a
 * missing result is already left out of every average. What a missing result cannot say is
 * whether the coach skipped it on purpose, so the evaluation also keeps a marker beside the
 * test's own score: the test's key plus "~na", with the value 0. It rides along with the
 * scores the evaluation already saves (so it needs no extra column), never counts as a score
 * (every check for "has a score" wants a value above 0), and lets reports print N/A.
 * Kept identical in both repos (src/lib/notAttempted.ts).
 */

export const NOT_ATTEMPTED_SUFFIX = '~na';

type Scores = Record<string, number> | undefined;

export const notAttemptedKey = (rubricKey: string): string => `${rubricKey}${NOT_ATTEMPTED_SUFFIX}`;

/** The test was marked as not attempted and has no result entered. */
export function isNotAttempted(scores: Scores, rubricKey: string): boolean {
  return scores?.[notAttemptedKey(rubricKey)] !== undefined && scores?.[rubricKey] == null;
}

/** These scores with a result entered for the test (entering one takes the marker off). */
export function withScore(scores: Scores, rubricKey: string, value: number): Record<string, number> {
  const { [notAttemptedKey(rubricKey)]: _marker, ...rest } = scores ?? {};
  return { ...rest, [rubricKey]: value };
}

/** These scores with the test's result removed and nothing marked, as if it was never touched. */
export function withoutScore(scores: Scores, rubricKey: string): Record<string, number> {
  const { [rubricKey]: _value, [notAttemptedKey(rubricKey)]: _marker, ...rest } = scores ?? {};
  return rest;
}

/** These scores with the test's result removed and the test marked as not attempted. */
export function withNotAttempted(scores: Scores, rubricKey: string): Record<string, number> {
  return { ...withoutScore(scores, rubricKey), [notAttemptedKey(rubricKey)]: 0 };
}

/** Every one of these tests is marked as not attempted. */
export function allNotAttempted(scores: Scores, rubricKeys: string[]): boolean {
  return rubricKeys.length > 0 && rubricKeys.every((k) => isNotAttempted(scores, k));
}

/** These scores with every listed test cleared and marked as not attempted: the skater took none of them. */
export function withAllNotAttempted(scores: Scores, rubricKeys: string[]): Record<string, number> {
  return rubricKeys.reduce<Record<string, number>>((acc, k) => withNotAttempted(acc, k), { ...(scores ?? {}) });
}

/** These scores with every listed test cleared and unmarked. */
export function withoutAnyNotAttempted(scores: Scores, rubricKeys: string[]): Record<string, number> {
  return rubricKeys.reduce<Record<string, number>>((acc, k) => (isNotAttempted(acc, k) ? withoutScore(acc, k) : acc), { ...(scores ?? {}) });
}

