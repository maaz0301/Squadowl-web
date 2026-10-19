import { SCORING_TYPE_LABELS } from './rubrics';
import type { CustomRubric, RubricLibraryInput, RubricLibraryItem } from './types';

/** The key a rubric gets in an evaluation: its name, lower-cased with underscores (the same rule as the rubric builders). */
export function rubricKeyFromName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

/** A library entry as the rubric an evaluation stores. Same name, so results line up across teams in the reports. */
export function rubricFromLibrary(item: RubricLibraryItem): CustomRubric {
  return {
    ...item.definition,
    key: rubricKeyFromName(item.name),
    label: item.name.trim(),
    scoringType: item.scoringType,
    scale: item.definition.scale ?? '1-5',
    rankingDirection: item.definition.rankingDirection ?? 'higher_is_better',
  };
}

/** What gets saved when a rubric from an evaluation (or the builder) goes into the library. */
export function libraryInputFromRubric(rubric: CustomRubric, sport?: string): RubricLibraryInput {
  const { key: _key, label, scoringType, ...definition } = rubric;
  return { name: label.trim(), sport: sport?.trim() || undefined, scoringType: scoringType ?? 'skill', definition };
}

/** Searchable by name, sport or measure type (and the category it files under). */
export function matchesRubricSearch(item: RubricLibraryItem, term: string): boolean {
  const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = [item.name, item.sport, item.scoringType, SCORING_TYPE_LABELS[item.scoringType], item.definition.category, item.definition.unit]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return words.every((w) => hay.includes(w));
}

/** A name for a duplicate that does not collide with an existing library entry. */
export function duplicateRubricName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()));
  const base = `${name.trim()} (copy)`;
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) {
    const candidate = `${name.trim()} (copy ${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}
