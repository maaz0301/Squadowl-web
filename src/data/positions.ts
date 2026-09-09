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
  Other: [],
};
