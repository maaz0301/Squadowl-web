/**
 * "Get directions" for a place — map deep links built from the free-text
 * location a coach typed on an event, practice, tryout or sort-out.
 *
 * There is no venue table and no geocoding step behind this: `location` (and
 * `rink` on an assessment) is one text column the coach fills in by hand, so
 * everything here is a pure string-to-URL transform. That is deliberate — it
 * means a location becomes directions the moment it is typed, with nothing to
 * migrate, provision or keep in sync.
 *
 * The trade-off is that the quality of the pin is the quality of what was
 * typed. "Rink A" resolves to whatever the map provider guesses; "Rink A, 55
 * Bloor St W, Toronto" lands on the door. `looksAddressable()` exists so a
 * creation form can say so before the invite goes out, rather than a parent
 * finding out on the morning of the game.
 */

/**
 * A bare coordinate pair, as some clubs paste in for rural fields with no
 * civic address. Matched so those can be handed to the provider as a point
 * rather than as a search phrase, which is the difference between a pin on the
 * field and a pin on the nearest town.
 */
const COORDS = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

export interface MapCoords {
  lat: number;
  lng: number;
}

/** The coordinates in `location`, if that is all it is. */
export function parseCoords(location: string): MapCoords | null {
  const m = COORDS.exec(location);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * Whether there is anything here worth offering directions to.
 *
 * Rejects the placeholders that show up in this column instead of an address —
 * a coach who hasn't decided yet types "TBD", and linking that to a map search
 * produces a confident pin on something entirely unrelated.
 */
export function hasMappableLocation(location?: string | null): location is string {
  const trimmed = location?.trim();
  if (!trimmed || trimmed.length < 2) return false;
  return !/^(tbd|tba|n\/?a|none|unknown|-+)$/i.test(trimmed);
}

/**
 * Whether the text reads like somewhere a map can actually find, rather than a
 * room name only the club knows ("Rink A", "Field 3", "Main Gym").
 *
 * A heuristic, and only ever used to *suggest* adding an address — never to
 * withhold the link, because a well-known venue name ("Scotiabank Arena")
 * resolves perfectly well and has none of these markers.
 */
export function looksAddressable(location: string): boolean {
  const trimmed = location.trim();
  if (parseCoords(trimmed)) return true;
  // A street number leading a word, a comma separating locality from venue, or
  // a postal/ZIP code anywhere in the string.
  if (/\d+\s+\p{L}/u.test(trimmed)) return true;
  if (trimmed.includes(',')) return true;
  if (/\b[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d\b/.test(trimmed)) return true; // Canadian postal code
  if (/\b\d{5}(-\d{4})?\b/.test(trimmed)) return true; // US ZIP
  return false;
}

/**
 * The query a provider should search for — the address text itself, and
 * nothing else. An earlier version prefixed the event/venue label onto it
 * ("Practice, 55 Bloor St W"), but the label is name the coach already sees
 * elsewhere on the same screen; folding it into the map query only risked
 * confusing the provider's parse on a label that reads like a place itself
 * (a team name, an event title). The address on its own is what a map needs.
 */
function searchQuery(location: string): string {
  return location.trim();
}

/**
 * Google Maps, via the documented universal `api=1` URLs. These open the Google
 * Maps app when it is installed on the device and the website when it isn't,
 * which is why they are preferred over `maps.google.com/?q=` everywhere here.
 */
export function googleMapsUrl(location: string): string {
  const params = new URLSearchParams({ api: '1', query: searchQuery(location) });
  return `https://www.google.com/maps/search/?${params.toString()}`;
}

/** Google Maps turn-by-turn, starting from wherever the viewer is. */
export function googleDirectionsUrl(location: string): string {
  const params = new URLSearchParams({
    api: '1',
    destination: searchQuery(location),
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Apple Maps. `maps.apple.com` opens the Maps app on an Apple device and falls
 * back to a web map elsewhere, so it is safe to offer to any viewer.
 */
export function appleMapsUrl(location: string): string {
  const coords = parseCoords(location);
  const params = new URLSearchParams(
    coords ? { ll: `${coords.lat},${coords.lng}` } : { q: searchQuery(location) },
  );
  return `https://maps.apple.com/?${params.toString()}`;
}

/** Apple Maps turn-by-turn. */
export function appleDirectionsUrl(location: string): string {
  const coords = parseCoords(location);
  const params = new URLSearchParams({
    daddr: coords ? `${coords.lat},${coords.lng}` : searchQuery(location),
    dirflg: 'd',
  });
  return `https://maps.apple.com/?${params.toString()}`;
}

/**
 * Waze. `waze.com/ul` opens the Waze app when installed and a web preview
 * otherwise; `navigate=yes` starts turn-by-turn immediately, the same "go"
 * intent the Apple/Google directions links carry.
 */
export function wazeUrl(location: string): string {
  const coords = parseCoords(location);
  const params = new URLSearchParams(
    coords
      ? { ll: `${coords.lat},${coords.lng}`, navigate: 'yes' }
      : { q: searchQuery(location), navigate: 'yes' },
  );
  return `https://waze.com/ul?${params.toString()}`;
}

/**
 * The platform-neutral `geo:` URI, which Android hands to whichever map app the
 * viewer has set as default. `0,0?q=` is the documented form for "search for
 * this text" when no coordinates are known.
 */
export function geoUri(location: string): string {
  const coords = parseCoords(location);
  if (coords) return `geo:${coords.lat},${coords.lng}`;
  return `geo:0,0?q=${encodeURIComponent(searchQuery(location))}`;
}

/**
 * The one link to use when there is room for only one — a line in an email, a
 * chip on a schedule row.
 *
 * Google's universal URL is the default rather than Apple's because it opens
 * the right thing on every platform including iOS (where it falls back to
 * Apple Maps' own web handoff if Google Maps isn't installed), whereas
 * `maps.apple.com` on Android is always a web map.
 */
export function mapUrl(location: string): string {
  return googleMapsUrl(location);
}
