import type { Sport } from './types';

/**
 * One selectable position per sport, shown in the Add Player position picker so
 * a coach chooses from the sport's real positions instead of typing free text.
 * `code` is what gets stored on the player (`pos`) and printed as the roster
 * badge, so it stays short — the same convention 'FWD'/'DEF'/'GTL' already used.
 *
 * Goalie-type codes ('G', 'GK') are recognized by `isGoaliePosition()`
 * alongside the legacy 'GTL', so roster filters, Team Builder's goalie split
 * and goalie-role rubrics all keep working once a sport picks its own code.
 */
export interface PositionOption {
  code: string;
  label: string;
}

export const POSITION_OPTIONS_BY_SPORT: Record<Sport, PositionOption[]> = {
  Hockey: [
    { code: 'G', label: 'Goaltender (G)' },
    { code: 'LD', label: 'Left Defense (LD)' },
    { code: 'RD', label: 'Right Defense (RD)' },
    { code: 'LW', label: 'Left Wing (LW)' },
    { code: 'C', label: 'Center (C)' },
    { code: 'RW', label: 'Right Wing (RW)' },
  ],
  Ringette: [
    { code: 'G', label: 'Goaltender (G)' },
    { code: 'LD', label: 'Left Defense (LD)' },
    { code: 'RD', label: 'Right Defense (RD)' },
    { code: 'C', label: 'Centre (C)' },
    { code: 'LF', label: 'Left Forward (LF)' },
    { code: 'RF', label: 'Right Forward (RF)' },
  ],
  Soccer: [
    { code: 'GK', label: 'Goalkeeper (GK)' },
    { code: 'CB', label: 'Center Back (CB)' },
    { code: 'FB', label: 'Full Back (LB/RB)' },
    { code: 'CDM', label: 'Defensive Midfielder (CDM)' },
    { code: 'CM', label: 'Central Midfielder (CM)' },
    { code: 'CAM', label: 'Attacking Midfielder (CAM)' },
    { code: 'W', label: 'Winger (LW/RW)' },
    { code: 'ST', label: 'Striker / Forward (ST)' },
  ],
  Football: [
    { code: 'QB', label: 'Quarterback (QB)' },
    { code: 'RB', label: 'Running Back (RB)' },
    { code: 'FB', label: 'Fullback (FB)' },
    { code: 'WR', label: 'Wide Receiver (WR)' },
    { code: 'TE', label: 'Tight End (TE)' },
    { code: 'OL', label: 'Offensive Line (C/G/T)' },
    { code: 'DL', label: 'Defensive Line (DE/DT)' },
    { code: 'LB', label: 'Linebacker (LB)' },
    { code: 'CB', label: 'Cornerback (CB)' },
    { code: 'S', label: 'Safety (FS/SS)' },
    { code: 'K', label: 'Kicker (K)' },
    { code: 'P', label: 'Punter (P)' },
  ],
  Basketball: [
    { code: 'PG', label: 'Point Guard (PG)' },
    { code: 'SG', label: 'Shooting Guard (SG)' },
    { code: 'SF', label: 'Small Forward (SF)' },
    { code: 'PF', label: 'Power Forward (PF)' },
    { code: 'C', label: 'Center (C)' },
  ],
  Tennis: [
    { code: 'S', label: 'Singles Player' },
    { code: 'DS', label: 'Doubles — Server' },
    { code: 'DR', label: 'Doubles — Receiver' },
    { code: 'DN', label: 'Doubles — Net Player' },
    { code: 'DB', label: 'Doubles — Baseline Player' },
  ],
  Volleyball: [
    { code: 'S', label: 'Setter (S)' },
    { code: 'OH', label: 'Outside Hitter (OH)' },
    { code: 'OPP', label: 'Opposite Hitter (OPP)' },
    { code: 'MB', label: 'Middle Blocker (MB)' },
    { code: 'L', label: 'Libero (L)' },
    { code: 'DS', label: 'Defensive Specialist (DS)' },
  ],
  Lacrosse: [
    { code: 'G', label: 'Goalie (G)' },
    { code: 'D', label: 'Defense (D)' },
    { code: 'M', label: 'Midfield (M)' },
    { code: 'FOGO', label: 'Face-off Midfielder (FOGO)' },
    { code: 'A', label: 'Attack (A)' },
  ],
  Baseball: [
    { code: 'P', label: 'Pitcher (P)' },
    { code: 'C', label: 'Catcher (C)' },
    { code: '1B', label: 'First Base (1B)' },
    { code: '2B', label: 'Second Base (2B)' },
    { code: '3B', label: 'Third Base (3B)' },
    { code: 'SS', label: 'Shortstop (SS)' },
    { code: 'LF', label: 'Left Field (LF)' },
    { code: 'CF', label: 'Center Field (CF)' },
    { code: 'RF', label: 'Right Field (RF)' },
    { code: 'DH', label: 'Designated Hitter (DH)' },
  ],
  Cricket: [
    { code: 'OB', label: 'Opening Batsman' },
    { code: 'MB', label: 'Middle-Order Batsman' },
    { code: 'FIN', label: 'Finisher / Lower-Order Batsman' },
    { code: 'FB', label: 'Fast/Pace Bowler' },
    { code: 'SB', label: 'Spin Bowler' },
    { code: 'AR', label: 'All-Rounder' },
    { code: 'WK', label: 'Wicket-Keeper (WK)' },
    { code: 'CAP', label: 'Captain' },
  ],
  Skating: [],
  Other: [],
};

/** One roster filter chip: a position category of the sport, and the position codes it covers. */
export interface PositionGroup {
  key: string;
  label: string;
  codes: string[];
}

/**
 * The position categories a roster can be filtered by, per sport, built from
 * the codes in POSITION_OPTIONS_BY_SPORT (plus the legacy FWD/DEF/GTL codes, and
 * both spellings cricket's middle-order code has had). A role that isn't a
 * playing position, like Cricket's Captain, belongs to no category.
 */
export const POSITION_GROUPS_BY_SPORT: Record<Sport, PositionGroup[]> = {
  Hockey: [
    { key: 'forwards', label: 'Forward', codes: ['LW', 'C', 'RW', 'FWD'] },
    { key: 'defense', label: 'Defense', codes: ['LD', 'RD', 'DEF'] },
    { key: 'goalies', label: 'Goalie', codes: ['G', 'GTL'] },
  ],
  Ringette: [
    { key: 'forwards', label: 'Forward', codes: ['C', 'LF', 'RF', 'FWD'] },
    { key: 'defense', label: 'Defense', codes: ['LD', 'RD', 'DEF'] },
    { key: 'goalies', label: 'Goalie', codes: ['G', 'GTL'] },
  ],
  Soccer: [
    { key: 'goalkeepers', label: 'Goalkeeper', codes: ['GK'] },
    { key: 'defenders', label: 'Defender', codes: ['CB', 'FB'] },
    { key: 'midfielders', label: 'Midfielder', codes: ['CDM', 'CM', 'CAM'] },
    { key: 'forwards', label: 'Forward', codes: ['W', 'ST'] },
  ],
  Football: [
    { key: 'offense', label: 'Offense', codes: ['QB', 'RB', 'FB', 'WR', 'TE', 'OL'] },
    { key: 'defense', label: 'Defense', codes: ['DL', 'LB', 'CB', 'S'] },
    { key: 'special-teams', label: 'Special Teams', codes: ['K', 'P'] },
  ],
  Basketball: [
    { key: 'guards', label: 'Guard', codes: ['PG', 'SG'] },
    { key: 'forwards', label: 'Forward', codes: ['SF', 'PF'] },
    { key: 'centers', label: 'Center', codes: ['C'] },
  ],
  Tennis: [
    { key: 'singles', label: 'Singles', codes: ['S'] },
    { key: 'doubles', label: 'Doubles', codes: ['DS', 'DR', 'DN', 'DB'] },
  ],
  Volleyball: [
    { key: 'setters', label: 'Setter', codes: ['S'] },
    { key: 'hitters', label: 'Hitter', codes: ['OH', 'OPP'] },
    { key: 'middles', label: 'Middle Blocker', codes: ['MB'] },
    { key: 'back-row', label: 'Libero / DS', codes: ['L', 'DS'] },
  ],
  Lacrosse: [
    { key: 'attack', label: 'Attack', codes: ['A'] },
    { key: 'midfield', label: 'Midfield', codes: ['M', 'FOGO'] },
    { key: 'defense', label: 'Defense', codes: ['D'] },
    { key: 'goalies', label: 'Goalie', codes: ['G'] },
  ],
  Baseball: [
    { key: 'pitchers', label: 'Pitcher', codes: ['P'] },
    { key: 'catchers', label: 'Catcher', codes: ['C'] },
    { key: 'infield', label: 'Infield', codes: ['1B', '2B', '3B', 'SS'] },
    { key: 'outfield', label: 'Outfield', codes: ['LF', 'CF', 'RF'] },
    { key: 'dh', label: 'Designated Hitter', codes: ['DH'] },
  ],
  Cricket: [
    { key: 'batters', label: 'Batter', codes: ['OB', 'MB', 'MOB', 'FIN'] },
    { key: 'bowlers', label: 'Bowler', codes: ['FB', 'SB'] },
    { key: 'all-rounders', label: 'All-Rounder', codes: ['AR'] },
    { key: 'wicket-keepers', label: 'Wicket-Keeper', codes: ['WK'] },
  ],
  Skating: [],
  Other: [],
};

/**
 * The position filter chips for a roster. 'Other' has no fixed positions, so it
 * gets one chip per position actually entered on the roster instead.
 */
export function rosterPositionGroups(sport: Sport, roster: { pos?: string | null }[]): PositionGroup[] {
  const groups = POSITION_GROUPS_BY_SPORT[sport];
  if (groups?.length) return groups;
  const codes = [...new Set(roster.map((p) => p.pos?.trim().toUpperCase()).filter((c): c is string => !!c))].sort();
  return codes.map((code) => ({ key: code.toLowerCase(), label: code, codes: [code] }));
}

const POSITION_MAP: Record<string, string> = {
  // Hockey & General
  'LEFT WING': 'LW',
  'RIGHT WING': 'RW',
  'CENTRE': 'C',
  'CENTER': 'C',
  'LEFT DEFENCE': 'LD',
  'LEFT DEFENSE': 'LD',
  'RIGHT DEFENCE': 'RD',
  'RIGHT DEFENSE': 'RD',
  'DEFENCE': 'DEF',
  'DEFENSE': 'DEF',
  'DEFENDER': 'DEF',
  'DEFENCEMAN': 'DEF',
  'DEFENSEMAN': 'DEF',
  'GOALIE': 'G',
  'GOALTENDER': 'G',
  'GOALKEEPER': 'GK',
  'FORWARD': 'FWD',
  'FORWARDS': 'FWD',
  // Soccer
  'CENTER BACK': 'CB',
  'CENTRE BACK': 'CB',
  'FULL BACK': 'FB',
  'FULLBACK': 'FB',
  'LEFT BACK': 'FB',
  'RIGHT BACK': 'FB',
  'DEFENSIVE MIDFIELDER': 'CDM',
  'CENTRAL MIDFIELDER': 'CM',
  'MIDFIELDER': 'CM',
  'MIDFIELD': 'CM',
  'ATTACKING MIDFIELDER': 'CAM',
  'WINGER': 'W',
  'STRIKER': 'ST',
  // Baseball
  'PITCHER': 'P',
  'CATCHER': 'C',
  'FIRST BASE': '1B',
  'SECOND BASE': '2B',
  'THIRD BASE': '3B',
  'SHORTSTOP': 'SS',
  'LEFT FIELD': 'LF',
  'CENTER FIELD': 'CF',
  'CENTRE FIELD': 'CF',
  'RIGHT FIELD': 'RF',
  'DESIGNATED HITTER': 'DH',
  // Basketball
  'POINT GUARD': 'PG',
  'SHOOTING GUARD': 'SG',
  'SMALL FORWARD': 'SF',
  'POWER FORWARD': 'PF',
  // Football
  'QUARTERBACK': 'QB',
  'RUNNING BACK': 'RB',
  'WIDE RECEIVER': 'WR',
  'TIGHT END': 'TE',
  'OFFENSIVE LINE': 'OL',
  'DEFENSIVE LINE': 'DL',
  'LINEBACKER': 'LB',
  'CORNERBACK': 'CB',
  'SAFETY': 'S',
  'KICKER': 'K',
  'PUNTER': 'P',
  // Volleyball
  'SETTER': 'S',
  'OUTSIDE HITTER': 'OH',
  'OPPOSITE HITTER': 'OPP',
  'MIDDLE BLOCKER': 'MB',
  'LIBERO': 'L',
  'DEFENSIVE SPECIALIST': 'DS',
  // Lacrosse
  'ATTACK': 'A',
  'ATTACKER': 'A',
  'FACE-OFF': 'FOGO',
  'FACEOFF': 'FOGO',
};

/**
 * Normalizes free-text or imported position labels (e.g. "Left Wing", "Defence", "Centre", "Goalie")
 * into standard sport position codes (e.g. "LW", "DEF", "C", "G").
 */
export function normalizePosition(pos?: string | null): string {
  if (!pos) return '';
  const trimmed = pos.trim().toUpperCase();
  return POSITION_MAP[trimmed] ?? trimmed;
}

export function isInPositionGroup(group: PositionGroup, pos?: string | null): boolean {
  if (!pos) return false;
  const raw = pos.trim().toUpperCase();
  const normalized = normalizePosition(pos);
  return group.codes.includes(raw) || group.codes.includes(normalized);
}
