import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_LETTER_TEMPLATES,
  buildLetterVars,
  letterRecipient,
  renderLetter,
  unfilledTokens,
} from './letters';

describe('buildLetterVars', () => {
  it('fills the context tokens from the player and assessment', () => {
    const vars = buildLetterVars({
      playerFirst: 'Jane',
      playerLast: 'Doe',
      guardianName: 'Sam Doe',
      teamName: 'U15 AAA Wolves',
      seasonName: '2026-27',
      coachName: 'Coach Ray',
      coachEmail: 'ray@club.ca',
    });
    expect(vars).toEqual({
      player_name: 'Jane Doe',
      parent_name: 'Sam Doe',
      team_name: 'U15 AAA Wolves',
      season: '2026-27',
      coach_name: 'Coach Ray',
      coach_email: 'ray@club.ca',
    });
  });

  it('addresses the player when no guardian is on file', () => {
    const vars = buildLetterVars({ playerFirst: 'Jane', playerLast: 'Doe' });
    expect(vars.parent_name).toBe('Jane Doe');
  });

  it('omits blank values so the token stays visible instead of rendering empty', () => {
    const vars = buildLetterVars({ playerFirst: 'Jane', playerLast: 'Doe', teamName: '   ' });
    expect(vars.team_name).toBeUndefined();
    expect(renderLetter('the {{team_name}} team', vars)).toBe('the {{team_name}} team');
  });
});

describe('renderLetter', () => {
  const vars = buildLetterVars({
    playerFirst: 'Jane',
    playerLast: 'Doe',
    guardianName: 'Sam Doe',
    teamName: 'Wolves',
    seasonName: '2026-27',
    coachName: 'Coach Ray',
    coachEmail: 'ray@club.ca',
  });

  it('substitutes every occurrence of a token', () => {
    expect(renderLetter('{{player_name}} and {{player_name}}', vars)).toBe('Jane Doe and Jane Doe');
  });

  it('tolerates whitespace and case inside the braces', () => {
    expect(renderLetter('{{ Player_Name }}', vars)).toBe('Jane Doe');
  });

  it('leaves tokens the coach is meant to write in place', () => {
    expect(renderLetter('Next: {{next_steps}}', vars)).toBe('Next: {{next_steps}}');
  });

  it('renders the built-in offer letter down to the authored tokens only', () => {
    const offer = BUILT_IN_LETTER_TEMPLATES.find((t) => t.kind === 'offer')!;
    expect(renderLetter(offer.subject, vars)).toBe("Congratulations, Jane Doe — You've Made the Wolves!");
    expect(unfilledTokens(renderLetter(offer.body, vars))).toEqual(['next_steps']);
  });

  it('renders the built-in decision letter down to the authored tokens only', () => {
    const decision = BUILT_IN_LETTER_TEMPLATES.find((t) => t.kind === 'decision')!;
    expect(unfilledTokens(renderLetter(decision.body, vars))).toEqual([
      'feedback_notes',
      'alternative_options',
    ]);
  });
});

describe('unfilledTokens', () => {
  it('deduplicates and keeps first-seen order', () => {
    expect(unfilledTokens('{{b}} {{a}} {{b}}')).toEqual(['b', 'a']);
  });

  it('is empty for a fully rendered letter', () => {
    expect(unfilledTokens('Hi Sam Doe, welcome aboard.')).toEqual([]);
  });
});

describe('letterRecipient', () => {
  it('prefers the guardian address', () => {
    expect(letterRecipient({ guardianEmail: 'sam@x.ca', playerEmail: 'jane@x.ca' })).toBe('sam@x.ca');
  });

  it('falls back to the player address', () => {
    expect(letterRecipient({ guardianEmail: '  ', playerEmail: 'jane@x.ca' })).toBe('jane@x.ca');
  });

  it('is undefined when there is nowhere to send', () => {
    expect(letterRecipient({})).toBeUndefined();
  });
});
