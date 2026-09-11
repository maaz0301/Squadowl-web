/**
 * Map deep links for the schedule email's "Get directions" button.
 *
 * Mirrors src/lib/mapLinks.ts in the web app (and src/lib/mapLinks.ts in the
 * mobile app) — same placeholder rejection, same universal Google URL, so a
 * location reads the same way on a schedule screen and in the email announcing
 * it. Kept as its own module rather than imported from the app because an edge
 * function has no access to the app's source tree.
 *
 * Deliberately no geocoding: `location` is one free-text column a coach fills
 * in, and turning it into a link is a pure string transform with nothing to
 * provision or keep in sync. The .ics attachment carries the same string in its
 * LOCATION property, which is what calendar clients hand to their own map app.
 */

/** Whether there is anything here worth offering directions to. */
export function hasMappableLocation(location?: string | null): boolean {
  const trimmed = location?.trim();
  if (!trimmed || trimmed.length < 2) return false;
  // "TBD" is what a coach types before the venue is settled; linking it
  // produces a confident pin on something entirely unrelated.
  return !/^(tbd|tba|n\/?a|none|unknown|-+)$/i.test(trimmed);
}

/**
 * Google Maps' documented universal URL. It opens the Maps app on iOS and
 * Android and the website on a desktop, so one link serves every recipient —
 * which matters more in an email than anywhere else, since there is no way to
 * detect the reader's platform.
 *
 * Only the address goes into the query — no event/team name prefixed onto it.
 * The label is still worth carrying for the visible link text, so callers pass
 * it separately rather than it being folded into the URL here.
 */
export function mapUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.trim())}`;
}
