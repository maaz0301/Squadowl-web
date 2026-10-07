import { describe, expect, it } from 'vitest';
import { isSidebarDestination } from './sidebarDestinations';

describe('isSidebarDestination', () => {
  it('matches sidebar destinations, with or without a trailing slash', () => {
    for (const p of ['/search', '/reports', '/payments', '/loyalty/', '/feedback/reports', '/founder', '/profile']) {
      expect(isSidebarDestination(p)).toBe(true);
    }
  });

  it('does not match drill-down or nested pages', () => {
    for (const p of ['/team/abc', '/team/new', '/assessment/new', '/assessment/1/settings', '/season/9/roster', '/founder/users/42', '/feedback/reports/7']) {
      expect(isSidebarDestination(p)).toBe(false);
    }
  });

  it('is false when there is no pathname', () => {
    expect(isSidebarDestination(null)).toBe(false);
    expect(isSidebarDestination(undefined)).toBe(false);
  });
});
