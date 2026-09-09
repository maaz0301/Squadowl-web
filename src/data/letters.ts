/**
 * Player selection letters — the templates a coach writes once, and the
 * per-player rendering that turns one into the letter a family receives.
 *
 * The shape follows how a coach actually runs the end of a tryout: two letters
 * go out, one to the players who made it and one to the players who didn't, and
 * both say the same thing to everybody apart from the names. So a template is
 * authored once per assessment (or reused across them — templates hang off the
 * account, not the tryout), and the per-player substitution happens at send
 * time against `buildLetterVars()` below.
 *
 * Placeholders are `{{snake_case}}`. Two kinds:
 *
 *   - *Context* tokens (player_name, parent_name, team_name, season,
 *     coach_name, coach_email) are filled automatically per player. The coach
 *     never types them.
 *   - *Authored* tokens (next_steps, feedback_notes, alternative_options) are
 *     prompts to the coach in the supplied templates — placeholders for
 *     paragraphs only they can write. They are NOT auto-filled: the coach
 *     replaces them while editing the template, and `unfilledTokens()` is what
 *     the send screen uses to warn about any they left behind, rather than
 *     mailing a family a literal `{{feedback_notes}}`.
 */

export const LETTER_KINDS = ['offer', 'decision', 'custom'] as const;

export type LetterKind = (typeof LETTER_KINDS)[number];

export const LETTER_KIND_LABELS: Record<LetterKind, string> = {
  offer: 'Offer Letter',
  decision: 'Roster Decision Letter',
  custom: 'Custom Letter',
};

export const LETTER_KIND_DESCRIPTIONS: Record<LetterKind, string> = {
  offer: 'For players who made the team.',
  decision: 'For players who were not selected.',
  custom: 'Anything else — a waitlist note, an affiliate invite, a thank-you.',
};

export interface LetterPlaceholder {
  /** The token as it appears in a body, without the braces. */
  token: string;
  label: string;
  /** Whether the app fills this in per player, or the coach writes it. */
  auto: boolean;
  hint: string;
}

export const LETTER_PLACEHOLDERS: LetterPlaceholder[] = [
  { token: 'player_name', label: 'Player name', auto: true, hint: "The player's full name." },
  { token: 'parent_name', label: 'Parent name', auto: true, hint: 'Their guardian, or the player if no guardian is on file.' },
  { token: 'team_name', label: 'Team name', auto: true, hint: 'The linked team, or the assessment name.' },
  { token: 'season', label: 'Season', auto: true, hint: "The assessment's season." },
  { token: 'coach_name', label: 'Coach name', auto: true, hint: 'Head coach, falling back to you.' },
  { token: 'coach_email', label: 'Coach email', auto: true, hint: 'Where replies should go.' },
  { token: 'next_steps', label: 'Next steps', auto: false, hint: 'What the family has to do now — write this yourself.' },
  { token: 'feedback_notes', label: 'Feedback notes', auto: false, hint: 'Development areas the staff noted — write this yourself.' },
  { token: 'alternative_options', label: 'Alternative options', auto: false, hint: 'Other programs to point them at — write this yourself.' },
];

/** The tokens `renderLetter()` substitutes; everything else is the coach's to write. */
export const AUTO_LETTER_TOKENS = LETTER_PLACEHOLDERS.filter((p) => p.auto).map((p) => p.token);

export interface BuiltInLetterTemplate {
  kind: LetterKind;
  name: string;
  subject: string;
  body: string;
}

/**
 * The two letters supplied with the feature request, transcribed as-is apart
 * from the trailing "Please respond to email: ____" line, which becomes a
 * {{coach_email}} token — a blank to hand-write makes sense on a printed sheet,
 * not in an email the app already knows the reply address for.
 */
export const BUILT_IN_LETTER_TEMPLATES: BuiltInLetterTemplate[] = [
  {
    kind: 'offer',
    name: 'Offer Letter (Made the Team)',
    subject: "Congratulations, {{player_name}} — You've Made the {{team_name}}!",
    body: `Hi {{parent_name}},

Congratulations to {{player_name}} on earning a spot on the {{team_name}} for the {{season}} season!

Our coaching staff was impressed with {{player_name}}'s performance throughout tryouts, and we're excited to have them join the team.

Next steps:
{{next_steps}}

If you have any questions, feel free to reach out to {{coach_name}} at {{coach_email}}.

Welcome aboard!

{{coach_name}}
{{team_name}} Coaching Staff

Please respond to: {{coach_email}}`,
  },
  {
    kind: 'decision',
    name: "Roster Decision Letter (Didn't Make the Team)",
    subject: '{{team_name}} Tryout Results — {{player_name}}',
    body: `Hi {{parent_name}},

Thank you for having {{player_name}} try out for the {{team_name}} this season. We had a strong group of athletes this year, which made our decisions difficult.

After careful evaluation, {{player_name}} was not selected for this year's roster.

Some areas our coaching staff noted for continued development:
{{feedback_notes}}

We genuinely encourage {{player_name}} to keep working on these skills — we'd love to see them try out again in the future. {{alternative_options}}

If you'd like more detailed feedback, {{coach_name}} is happy to talk — reach out at {{coach_email}}.

Thank you again for your time and effort during tryouts.

{{coach_name}}
{{team_name}} Coaching Staff

Please respond to: {{coach_email}}`,
  },
];

/** The per-player values a letter is rendered against. */
export type LetterVars = Record<string, string>;

export interface LetterContext {
  playerFirst: string;
  playerLast: string;
  guardianName?: string;
  teamName?: string;
  seasonName?: string;
  coachName?: string;
  coachEmail?: string;
}

/**
 * The auto-filled half of a letter's substitutions.
 *
 * Every value is a non-empty string or the token is left out entirely, so
 * `renderLetter()` leaves `{{team_name}}` visible rather than quietly mailing
 * "Congratulations on making the !" when an assessment has no team linked.
 * `unfilledTokens()` then catches it before the send.
 */
export function buildLetterVars(ctx: LetterContext): LetterVars {
  const playerName = `${ctx.playerFirst} ${ctx.playerLast}`.trim();
  const vars: LetterVars = {};
  const put = (token: string, value?: string) => {
    const v = value?.trim();
    if (v) vars[token] = v;
  };

  put('player_name', playerName);
  // A letter addressed to the family reads to whoever is on file; with no
  // guardian recorded the player themselves is the right salutation, not a
  // dangling "Hi ,".
  put('parent_name', ctx.guardianName || playerName);
  put('team_name', ctx.teamName);
  put('season', ctx.seasonName);
  put('coach_name', ctx.coachName);
  put('coach_email', ctx.coachEmail);
  return vars;
}

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/** Substitutes `{{token}}` for each key in `vars`; unknown tokens are left in place. */
export function renderLetter(text: string, vars: LetterVars): string {
  return text.replace(TOKEN_RE, (match, token: string) => {
    const value = vars[token.toLowerCase()];
    return value === undefined ? match : value;
  });
}

/**
 * Tokens still standing in a rendered letter, deduplicated and in the order
 * they appear — what the send screen warns about.
 */
export function unfilledTokens(text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const token = m[1].toLowerCase();
    if (!found.includes(token)) found.push(token);
  }
  return found;
}

/**
 * Where a letter for this player should be sent.
 *
 * Guardian first: these letters are addressed to a parent, and a minor's own
 * address (when there is one at all) is the less likely one to be read.
 */
export function letterRecipient(player: {
  guardianEmail?: string;
  playerEmail?: string;
}): string | undefined {
  return player.guardianEmail?.trim() || player.playerEmail?.trim() || undefined;
}
