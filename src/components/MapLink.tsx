'use client';

import type { CSSProperties } from 'react';

import { Icon } from '@/components/Icons';
import { googleMapsUrl, hasMappableLocation, looksAddressable } from '@/lib/mapLinks';
import { useThemeColors } from '@/theme/ThemeProvider';

/**
 * "Directions" for an event's location.
 *
 * One link rather than a provider menu like AddToCalendar's: Google's universal
 * maps URL opens the native Maps app on iOS and Android and the website on a
 * desktop, so there is nothing for the recipient to choose between. A parent
 * looking at a game two hours before puff-off should be one tap from their
 * navigation, not one tap from a list of map brands.
 *
 * Renders nothing at all when there is no usable location — including the
 * "TBD" a coach types before the venue is settled, which would otherwise send
 * someone confidently to whatever a map search makes of it.
 */
export function MapLink({
  location,
  label,
  size = 'md',
  variant = 'chip',
}: {
  location?: string | null;
  /** Venue or event name, used to name the pin. */
  label?: string;
  size?: 'sm' | 'md';
  /**
   * `chip` is the standalone button used beside "Add to calendar"; `inline`
   * turns the location text itself into the link, for rows too tight for
   * another button.
   */
  variant?: 'chip' | 'inline';
}) {
  const colors = useThemeColors();
  if (!hasMappableLocation(location)) return null;

  // Only the address goes to the map provider — `label` (the event/venue name)
  // is used below for the tooltip only, never folded into the query itself.
  const href = googleMapsUrl(location);
  const pad = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  const title = label ? `Directions to ${label}` : `Directions to ${location.trim()}`;

  if (variant === 'inline') {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:opacity-80"
        style={{ color: colors.primary }}
      >
        <Icon name="mapPin" size={size === 'sm' ? 12 : 14} color={colors.primary} />
        {location.trim()}
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-lg font-semibold transition-colors hover:brightness-110 ${pad}`}
      style={{
        backgroundColor: colors.tile,
        color: colors.ink,
        border: `1px solid ${colors.border}`,
      }}
    >
      <Icon name="mapPin" size={size === 'sm' ? 13 : 15} color={colors.primary} />
      Directions
    </a>
  );
}

/**
 * The hint shown under a location field while an event is being created.
 *
 * A venue typed as "Rink A" is perfectly clear to the club and useless to a map,
 * and the moment to find that out is while the coach is still on the form —
 * not after the invite has gone out. It never blocks the save: a well-known
 * venue name maps fine and has none of the markers `looksAddressable` looks for.
 */
export function MapLocationHint({ location }: { location?: string | null }) {
  const colors = useThemeColors();
  const trimmed = location?.trim();
  if (!trimmed) return null;

  const mappable = hasMappableLocation(trimmed);
  const vague = mappable && !looksAddressable(trimmed);

  const style: CSSProperties = { color: vague ? colors.warning : colors.inkMuted };

  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" style={style}>
      {vague ? (
        <span>Add a street address so players can get directions.</span>
      ) : mappable ? (
        <span style={{ color: colors.inkMuted }}>Players will get a directions link to this location.</span>
      ) : null}
      {mappable ? (
        <a
          href={googleMapsUrl(trimmed)}
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold underline decoration-dotted underline-offset-2 hover:opacity-80"
          style={{ color: colors.primary }}
        >
          Preview on map
        </a>
      ) : null}
    </p>
  );
}
