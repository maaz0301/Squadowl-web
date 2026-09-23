/**
 * Whether the "your plan is changing" notice has been dismissed in this login
 * session. Kept in sessionStorage so a page reload doesn't bring it back, and
 * cleared on every login/logout so the next login shows it again.
 */
const KEY = 'aas_plan_notice_dismissed';

export function isPlanNoticeDismissed(userId: string | undefined): boolean {
  if (!userId) return false;
  try {
    return window.sessionStorage.getItem(KEY) === userId;
  } catch {
    return false;
  }
}

export function dismissPlanNotice(userId: string): void {
  try {
    window.sessionStorage.setItem(KEY, userId);
  } catch {
    // Storage blocked: the banner just stays until the tab reloads.
  }
}

export function resetPlanNotice(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
