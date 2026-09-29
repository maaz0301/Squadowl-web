import type { CustomLabels } from '@/data/types';

/**
 * The few terms an account can rename. Everything defaults to the standard
 * name, so an account that never touches this sees no change at all.
 */
export interface Terms {
  /** Singular, e.g. "Player" or "Skater". */
  player: string;
  /** Plural, derived from the singular. */
  players: string;
  /** e.g. "Jersey #" or "Skate Ontario #". */
  jersey: string;
  /** The sport's display name, e.g. "Hockey" -> "Skating". */
  sport: string;
}

export const DEFAULT_TERMS: Terms = { player: 'Player', players: 'Players', jersey: 'Jersey #', sport: 'Hockey' };

export const LABEL_MAX_LENGTH = 30;

/** "Skater" -> "Skaters", "Athlete" -> "Athletes", "Goalie" -> "Goalies", "Bus" -> "Buses". */
export function pluralize(word: string): string {
  const w = word.trim();
  if (!w) return w;
  if (/(s|x|z|ch|sh)$/i.test(w)) return `${w}es`;
  if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
  return `${w}s`;
}

export const cleanLabel = (v: string | undefined) => (v ?? '').trim().slice(0, LABEL_MAX_LENGTH);

export function resolveTerms(labels?: CustomLabels | null): Terms {
  const player = cleanLabel(labels?.player) || DEFAULT_TERMS.player;
  return {
    player,
    players: cleanLabel(labels?.player) ? pluralize(player) : DEFAULT_TERMS.players,
    jersey: cleanLabel(labels?.jersey) || DEFAULT_TERMS.jersey,
    sport: cleanLabel(labels?.sport) || DEFAULT_TERMS.sport,
  };
}

export type TermsWithT = Terms & {
  /** Rewrites standard wording in a static string: "Score Players" -> "Score Skaters". No-op for the defaults. */
  t: (text: string) => string;
};

const cap = (w: string) => (w ? w[0].toUpperCase() + w.slice(1) : w);
const low = (w: string) => (w ? w[0].toLowerCase() + w.slice(1) : w);

/** Swap "Player(s)" / "player(s)" / "Jersey #" / "Jersey" for this evaluation's words. */
export function makeT(terms: Terms): (text: string) => string {
  const customPlayer = terms.player !== DEFAULT_TERMS.player;
  const customJersey = terms.jersey !== DEFAULT_TERMS.jersey;
  if (!customPlayer && !customJersey) return (text) => text;
  const bareJersey = terms.jersey.replace(/\s*#\s*$/, '');
  return (text) => {
    let out = text;
    if (customJersey) {
      out = out
        .replace(/\bJersey #/g, terms.jersey)
        .replace(/\bjersey #/g, low(terms.jersey))
        .replace(/\bJersey\b/g, bareJersey)
        .replace(/\bjersey\b/g, low(bareJersey));
    }
    if (customPlayer) {
      out = out
        .replace(/\bPlayers\b/g, cap(terms.players))
        .replace(/\bplayers\b/g, low(terms.players))
        .replace(/\bPlayer\b/g, cap(terms.player))
        .replace(/\bplayer\b/g, low(terms.player));
    }
    return out;
  };
}

/** Renames only the sport the account chose to rename; other sports keep their own name. */
export function sportLabel(sport: string | undefined, terms: Terms): string {
  if (!sport) return sport ?? '';
  return sport === DEFAULT_TERMS.sport ? terms.sport : sport;
}

/** The wording rewriter for an evaluation's exports, straight from its own settings. */
export function termsFor(tryout: { settings?: { customLabels?: CustomLabels } }): (text: string) => string {
  return makeT(resolveTerms(tryout.settings?.customLabels));
}
