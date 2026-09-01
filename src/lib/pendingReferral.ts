import { storage } from '@/lib/storage';

/**
 * A referral code entered at signup, held in local storage until there is a
 * session to attach it to.
 *
 * Signup can't apply the code inline. `enable_confirmations` is on for this
 * project, so `supabase.auth.signUp()` comes back with no session and
 * SupabaseDataSource.signup() throws "Account created. Please confirm your
 * email, then log in." — every statement after the signup call is skipped, so
 * an inline applyReferralCode() there is dead code for anyone who has to verify
 * their e-mail first (i.e. everyone). The code is written here *before* signup
 * is attempted, and flushed on the first authenticated session instead.
 */
const KEY = 'aas_pending_referral';

/**
 * Attribution is a one-shot write, so a code that keeps failing is a code the
 * server is rejecting on the merits (already applied, self-referral, unknown).
 * Give up after a handful of tries rather than re-running it on every load
 * forever.
 */
const MAX_ATTEMPTS = 5;

interface Pending {
  code: string;
  attempts: number;
}

function read(): Pending | null {
  const raw = storage.getString(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Pending;
    return parsed?.code ? parsed : null;
  } catch {
    return null;
  }
}

export function savePendingReferralCode(code: string): void {
  const clean = code.trim().toUpperCase();
  if (!clean) return;
  storage.set(KEY, JSON.stringify({ code: clean, attempts: 0 } as Pending));
}

export function getPendingReferralCode(): string | null {
  return read()?.code ?? null;
}

export function clearPendingReferralCode(): void {
  storage.remove(KEY);
}

/**
 * Applies a stored code if there is one. Safe to call on every login and
 * session restore: it reads one key and returns immediately when nothing is
 * pending. Never throws — a failed attribution must not break signing in.
 *
 * Returns true only when a code was actually applied on this call.
 */
export async function flushPendingReferralCode(): Promise<boolean> {
  const pending = read();
  if (!pending) return false;

  try {
    // Imported lazily to keep this module free of the data layer, which reaches
    // back into the auth session that imports this.
    const { getDataSource } = await import('@/data');
    await getDataSource().applyReferralCode(pending.code);
    storage.remove(KEY);
    return true;
  } catch (e) {
    const attempts = (pending.attempts ?? 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
      console.warn('Giving up on pending referral code:', e);
      storage.remove(KEY);
    } else {
      storage.set(KEY, JSON.stringify({ code: pending.code, attempts } as Pending));
    }
    return false;
  }
}
