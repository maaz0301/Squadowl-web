'use client';

import { useEffect } from 'react';
import { useAuthStore } from '@/state/authStore';
import { useAlert } from '@/components/ui';

/**
 * Tells the user why they were just sent back to /login.
 *
 * Mounted in Providers — inside AlertProvider but above the router outlet — so
 * it survives the redirect the expiry triggers. A toast fired from the screen
 * that hit the error would be torn down with that screen before anyone read
 * it, and one fired during boot would land before any page had mounted.
 */
export function SessionExpiryNotice() {
  const expired = useAuthStore((s) => s.sessionExpired);
  const clearSessionExpired = useAuthStore((s) => s.clearSessionExpired);
  const { toast } = useAlert();

  useEffect(() => {
    if (!expired) return;
    toast('Your session expired — please sign in again.', 'danger');
    clearSessionExpired();
  }, [expired, clearSessionExpired, toast]);

  return null;
}
