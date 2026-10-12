import { describe, expect, it } from 'vitest';

import { BRAND_LOGO_DATA_URI } from '@/lib/brandLogo';
import { reportLogoUrls } from '@/lib/reportPdf';

describe('reportLogoUrls', () => {
  it('prints the team logo then the SquadOwl logo by default', () => {
    expect(reportLogoUrls({ club: false, teamLogoUrl: 'team.png' })).toEqual(['team.png', BRAND_LOGO_DATA_URI]);
  });
  it('leaves the SquadOwl logo off when a coach has a logo of their own and turns it off', () => {
    expect(reportLogoUrls({ club: false, teamLogoUrl: 'team.png', appLogo: false })).toEqual(['team.png']);
    expect(reportLogoUrls({ club: true, organizationLogoUrl: 'org.png', teamLogoUrl: 'team.png', appLogo: false })).toEqual(['org.png', 'team.png']);
  });
  it('never leaves a report with no logo at all', () => {
    expect(reportLogoUrls({ club: false, appLogo: false })).toEqual([BRAND_LOGO_DATA_URI]);
  });
  it('keeps the organization logo to club accounts', () => {
    expect(reportLogoUrls({ club: false, organizationLogoUrl: 'org.png' })).toEqual([BRAND_LOGO_DATA_URI]);
  });
});
