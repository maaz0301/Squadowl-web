/**
 * What a sport's player card asks for and what its players are called. A sport
 * that is not listed here keeps the standard hockey-shaped card, so every
 * existing team and evaluation is unchanged.
 */

export interface SportProfile {
  /** The default word for a participant, before any rename an account or evaluation makes. */
  player: string;
  /** The default label for the number field. */
  numberLabel: string;
  /** Whether the sport has playing positions to pick. */
  positions: boolean;
  /** Whether the card asks which way the player shoots. */
  shoots: boolean;
}

const STANDARD: SportProfile = { player: 'Player', numberLabel: 'Jersey #', positions: true, shoots: true };

const PROFILES: Record<string, SportProfile> = {
  // Skaters are not on a line-up: no positions, no handedness, and no jersey,
  // only the number they are known by.
  Skating: { player: 'Skater', numberLabel: 'Skater #', positions: false, shoots: false },
};

export function sportProfile(sport?: string | null): SportProfile {
  return (sport && PROFILES[sport]) || STANDARD;
}
