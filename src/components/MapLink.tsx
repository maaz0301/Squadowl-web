'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { Icon } from '@/components/Icons';
import { HubActionTile } from '@/components/teamHub/HubActionTile';
import {
  appleDirectionsUrl,
  googleMapsUrl,
  hasMappableLocation,
  looksAddressable,
  wazeUrl,
} from '@/lib/mapLinks';
import { useThemeColors } from '@/theme/ThemeProvider';

// Brand spot-colors, used only as small identifying accents on the provider
// badges below — everything else in the menu stays on theme tokens so it
// still reads correctly in both light and dark. Mirrors AddToCalendar's own
// ProviderBadge treatment.
const GOOGLE_BLUE = '#4285F4';
const APPLE_GRAY = '#555555';
const WAZE_BLUE = '#05C8F7';

/** A small round icon/letter mark identifying a map provider. */
function ProviderBadge({ bg, fg, children }: { bg: string; fg: string; children: ReactNode }) {
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold"
      style={{ backgroundColor: bg, color: fg }}
    >
      {children}
    </span>
  );
}

/**
 * "Directions" for an event's location — a small provider menu, the same
 * pattern as AddToCalendar, so a parent can open whichever of Apple Maps,
 * Google Maps or Waze they actually have set up with saved places and voice
 * guidance, rather than always landing on Google's regardless of preference.
 *
 * The menu positions itself with `fixed` coordinates computed from the
 * trigger button's own rect, clamped to the viewport — see AddToCalendar for
 * why plain `absolute right-0` doesn't hold up inside a narrow card.
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
   * turns the location text itself into the trigger, for rows too tight for
   * another button. `tile` is the Team Hub's own action button.
   */
  variant?: 'chip' | 'inline' | 'tile';
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // Nothing to measure while closed — the menu is unmounted below, so a
    // stale `pos` sitting around until the next open is never read.
    if (!open) return;
    const btn = btnRef.current;
    const menu = menuRef.current;
    if (!btn || !menu) return;

    const margin = 8;
    const btnRect = btn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();

    let left = btnRect.right - menuRect.width; // right-align to the button, like before...
    left = Math.min(Math.max(left, margin), window.innerWidth - menuRect.width - margin); // ...but never past a viewport edge.

    let top = btnRect.bottom + 6;
    if (top + menuRect.height > window.innerHeight - margin) {
      top = btnRect.top - menuRect.height - 6; // flip above the button if there's no room below.
    }
    top = Math.max(top, margin);

    setPos({ top, left });
  }, [open]);

  // Scrolling or resizing invalidates the measured position; closing is the
  // simple, correct response rather than tracking it continuously.
  useLayoutEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!btnRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!hasMappableLocation(location)) return null;

  // Only the address goes to the map provider — `label` (the event/venue
  // name) is used below for the tooltip only, never folded into the query.
  const place = location.trim();
  const title = label ? `Directions to ${label}` : `Directions to ${place}`;
  const pad = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm';

  const options = [
    { key: 'apple', name: 'Apple Maps', url: appleDirectionsUrl(place), bg: `${APPLE_GRAY}26`, fg: APPLE_GRAY, mark: 'A' },
    { key: 'google', name: 'Google Maps', url: googleMapsUrl(place), bg: `${GOOGLE_BLUE}26`, fg: GOOGLE_BLUE, mark: 'G' },
    { key: 'waze', name: 'Waze', url: wazeUrl(place), bg: `${WAZE_BLUE}26`, fg: WAZE_BLUE, mark: 'W' },
  ] as const;

  const menuStyle: CSSProperties & Record<'--menu-hover', string> = {
    backgroundColor: colors.card,
    border: `1px solid ${colors.borderStrong}`,
    boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
    '--menu-hover': colors.tile,
  };

  const itemClass =
    'flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-[var(--menu-hover)]';

  const menu = open ? (
    <div
      ref={menuRef}
      role="menu"
      className="fixed z-50 w-56 rounded-2xl p-1.5 transition-opacity duration-100"
      style={{ ...menuStyle, top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0 }}
    >
      {options.map((o) => (
        <a
          key={o.key}
          role="menuitem"
          href={o.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setOpen(false)}
          className={itemClass}
        >
          <ProviderBadge bg={o.bg} fg={o.fg}>
            {o.mark}
          </ProviderBadge>
          <span className="text-sm font-semibold" style={{ color: colors.ink }}>
            {o.name}
          </span>
        </a>
      ))}
    </div>
  ) : null;

  if (variant === 'tile') {
    return (
      <>
        <HubActionTile
          buttonRef={btnRef}
          icon="mapPin"
          label="Directions"
          title={title}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        />
        {menu}
      </>
    );
  }

  if (variant === 'inline') {
    return (
      <>
        <button
          ref={btnRef}
          type="button"
          title={title}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:opacity-80"
          style={{ color: colors.primary }}
        >
          <Icon name="mapPin" size={size === 'sm' ? 12 : 14} color={colors.primary} />
          {place}
        </button>
        {menu}
      </>
    );
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-lg font-semibold transition-colors hover:brightness-110 ${pad}`}
        style={{
          backgroundColor: open ? colors.primarySoft : colors.tile,
          color: colors.ink,
          border: `1px solid ${open ? colors.primary : colors.border}`,
        }}
      >
        <Icon name="mapPin" size={size === 'sm' ? 13 : 15} color={colors.primary} />
        Directions
      </button>
      {menu}
    </>
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
