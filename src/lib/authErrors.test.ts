import { describe, expect, it } from 'vitest';
import { isAuthExpiredError } from './authErrors';

/**
 * The classifier decides whether a failure ends the session, so both
 * directions matter: miss the expiry and the user sits on a broken screen with
 * no idea why; over-match and an ordinary permission error throws them out of
 * a session that was still perfectly good.
 */
describe('isAuthExpiredError', () => {
  it('matches the refresh-token failure by code', () => {
    expect(
      isAuthExpiredError({
        code: 'refresh_token_not_found',
        message: 'Invalid Refresh Token: Refresh Token Not Found',
      }),
    ).toBe(true);
  });

  it('matches the same failure re-thrown as a bare Error', () => {
    expect(isAuthExpiredError(new Error('Invalid Refresh Token: Refresh Token Not Found'))).toBe(true);
  });

  it("matches resolveUserId()'s throw", () => {
    // The string the old exact-equality check missed.
    expect(isAuthExpiredError(new Error('User not authenticated'))).toBe(true);
  });

  it('matches an expired JWT from the data API', () => {
    expect(isAuthExpiredError({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
  });

  it('leaves an ordinary permission failure alone', () => {
    expect(
      isAuthExpiredError({
        code: '42501',
        message: 'new row violates row-level security policy for table "teams"',
      }),
    ).toBe(false);
  });

  it('leaves a wrong-password sign-in alone', () => {
    expect(isAuthExpiredError({ code: 'invalid_credentials', message: 'Invalid login credentials' })).toBe(
      false,
    );
  });

  it('ignores non-errors', () => {
    expect(isAuthExpiredError(null)).toBe(false);
    expect(isAuthExpiredError('refresh_token_not_found')).toBe(false);
  });
});
