import { getSupabase } from '@/lib/supabase';
import { storage } from '@/lib/storage';

/**
 * Product analytics for the founder console's Analytics page — deliberately
 * tiny: sign-in/sign-up page visits, and which feature screens get opened.
 * Both are fire-and-forget; a failure (migration not applied, offline) is
 * swallowed so tracking can never break a screen.
 * See supabase/migrations/20260917120000_founder_analytics.sql.
 */

/**
 * Feature catalog: a screen counts as a use of a feature when its path matches.
 * First match wins, so more specific paths go first. The key is what's stored;
 * renaming a label is free, renaming a key splits its history.
 *
 * `area` is display-only grouping for the founder console's "What's tracked?"
 * modal (see FeaturesInfoModal) — it plays no part in matching or storage.
 */
export const FEATURES: { key: string; label: string; match: RegExp; area: string }[] = [
  { key: 'new_evaluation', label: 'New Evaluation', match: /^\/(assessment\/new|wizard)(\/|$)/, area: 'Evaluations' },
  { key: 'rinkside', label: 'Rinkside Mode', match: /^\/assessment\/[^/]+\/rinkside/, area: 'Evaluations' },
  { key: 'scoring', label: 'Player Scoring', match: /^\/assessment\/[^/]+\/score\//, area: 'Evaluations' },
  { key: 'scan_sheet', label: 'Scan Sheet', match: /^\/assessment\/[^/]+\/scan-sheet/, area: 'Evaluations' },
  { key: 'team_builder', label: 'Team Builder', match: /^\/assessment\/[^/]+\/team-builder/, area: 'Evaluations' },
  { key: 'compare', label: 'Player Compare', match: /^\/assessment\/[^/]+\/compare/, area: 'Evaluations' },
  { key: 'results', label: 'Results', match: /^\/assessment\/[^/]+\/results/, area: 'Evaluations' },
  { key: 'export', label: 'Export', match: /^\/assessment\/[^/]+\/export/, area: 'Evaluations' },
  { key: 'selection_letters', label: 'Selection Letters', match: /^\/assessment\/[^/]+\/letters/, area: 'Evaluations' },
  { key: 'registrations', label: 'Registrations', match: /^\/assessment\/[^/]+\/registrations/, area: 'Evaluations' },
  { key: 'rubrics', label: 'Rubrics', match: /^\/assessment\/[^/]+\/rubrics/, area: 'Evaluations' },
  { key: 'roster_library', label: 'Roster Library', match: /^\/assessment\/[^/]+\/roster-library/, area: 'Evaluations' },
  { key: 'combine', label: 'Combine', match: /^\/combine(\/|$)/, area: 'Evaluations' },
  { key: 'season_schedule', label: 'Season Schedule', match: /^\/season\/[^/]+\/(calendar|schedule)/, area: 'Season & team' },
  { key: 'attendance', label: 'Attendance', match: /^\/season\/[^/]+\/attendance/, area: 'Season & team' },
  { key: 'availability', label: 'Availability', match: /^\/season\/[^/]+\/availability/, area: 'Season & team' },
  { key: 'team_chat', label: 'Team Chat', match: /^\/(season|team)\/[^/]+\/chat/, area: 'Season & team' },
  { key: 'payments', label: 'Payments', match: /^\/payments(\/|$)/, area: 'Account-wide' },
  { key: 'enterprise_dashboard', label: 'Enterprise Dashboard', match: /^\/enterprise(\/|$)/, area: 'Account-wide' },
  { key: 'library', label: 'Library', match: /^\/library(\/|$)/, area: 'Account-wide' },
  { key: 'athlete_sharing', label: 'Athlete Sharing', match: /^\/(shared-athletes|share)(\/|$)/, area: 'Account-wide' },
  { key: 'search', label: 'Search', match: /^\/search(\/|$)/, area: 'Account-wide' },
  { key: 'loyalty', label: 'Loyalty Program', match: /^\/loyalty(\/|$)/, area: 'Account-wide' },
  { key: 'guardian_portal', label: 'Guardian Portal', match: /^\/(guardian|my-athletes)(\/|$)/, area: 'Account-wide' },
  { key: 'plans_billing', label: 'Plans & Billing', match: /^\/upgrade(\/|$)/, area: 'Account-wide' },
  { key: 'feedback', label: 'Feedback', match: /^\/feedback$/, area: 'Account-wide' },
];

export function featureForPath(pathname: string): string | null {
  return FEATURES.find((f) => f.match.test(pathname))?.key ?? null;
}

export function featureLabel(key: string): string {
  return (
    FEATURES.find((f) => f.key === key)?.label ??
    key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
  );
}

export function trackFeatureUse(feature: string): void {
  try {
    void getSupabase()
      .rpc('track_feature_use', { p_feature: feature })
      .then(({ error }) => {
        if (error) console.debug('Feature tracking skipped:', error.message);
      });
  } catch {
    // Supabase not configured — nothing to record.
  }
}

const VISITOR_KEY = 'analytics_visitor_id';

function visitorId(): string | null {
  try {
    let id = storage.getString(VISITOR_KEY);
    if (!id) {
      if (typeof crypto === 'undefined' || !crypto.randomUUID) return null;
      id = crypto.randomUUID();
      storage.set(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

/** Records one visit to a public page (deduped server-side per visitor, page and day). */
export function trackVisit(pathname: string): void {
  if (typeof window === 'undefined') return;
  const id = visitorId();
  if (!id) return;

  const params = new URLSearchParams(window.location.search);
  let referrerHost: string | null = null;
  try {
    const host = document.referrer ? new URL(document.referrer).host : '';
    referrerHost = host && host !== window.location.host ? host : null;
  } catch {
    referrerHost = null;
  }

  try {
    void getSupabase()
      .rpc('track_visit', {
        p_visitor_id: id,
        p_path: pathname,
        p_referrer_host: referrerHost,
        p_utm_source: params.get('utm_source'),
        p_utm_medium: params.get('utm_medium'),
        p_utm_campaign: params.get('utm_campaign'),
        p_ref_code: params.get('ref'),
      })
      .then(({ error }) => {
        if (error) console.debug('Visit tracking skipped:', error.message);
      });
  } catch {
    // Supabase not configured — nothing to record.
  }
}
