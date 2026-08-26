/**
 * Auth error codes that mean the stored session is gone for good.
 *
 * `refresh_token_not_found` is the one users actually hit: the access token
 * expired, the client traded the refresh token for a new one, and the Auth
 * server had no such token — it was rotated out by another tab, revoked by a
 * password change or a "sign out everywhere", or aged past its own lifetime.
 * The SDK already refreshes on its own (`autoRefreshToken: true`), so this
 * error *is* the failed refresh; there is nothing left to retry, and the only
 * recovery is signing in again.
 *
 * `PGRST301` is PostgREST's own code for a request whose JWT had already
 * expired — the same dead session seen from the data API rather than the Auth
 * API.
 */
const EXPIRED_CODES = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_not_found',
  'session_expired',
  'bad_jwt',
  'no_authorization',
  'PGRST301',
]);

/**
 * Lowercased substrings for the same failures arriving without a code — an
 * error re-thrown as a plain `Error`, or one of this codebase's own throws.
 * `user not authenticated` is what `resolveUserId()` raises, which sits in
 * front of ~90 datasource methods and so is the single most likely way a dead
 * session surfaces to a screen.
 */
const EXPIRED_MESSAGES = [
  'invalid refresh token',
  'refresh token not found',
  'auth session missing',
  'jwt expired',
  'not authenticated',
];

/**
 * Does this error mean "the session is over, send the user back to sign in"?
 *
 * Deliberately narrow: it must not catch an ordinary permission failure (a
 * coach hitting a row RLS won't hand over is still signed in), only the cases
 * where no further request of any kind can succeed.
 */
export function isAuthExpiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  if (typeof code === 'string' && EXPIRED_CODES.has(code)) return true;
  if (typeof message !== 'string') return false;
  const lower = message.toLowerCase();
  return EXPIRED_MESSAGES.some((m) => lower.includes(m));
}
