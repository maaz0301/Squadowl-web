'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

import { Icon } from '@/components/Icons';
import {
  downloadIcs,
  googleCalendarUrl,
  outlookCalendarUrl,
  type CalendarEvent,
} from '@/lib/calendarLinks';
import { useThemeColors } from '@/theme/ThemeProvider';
import type { SeasonEvent } from '@/data/types';

/**
 * Everything the calendar builders need from an event, and nothing more.
 *
 * A structural subset rather than `SeasonEvent` itself so the /rsvp landing
 * page — which only ever holds the one event its token unlocked, not a full
 * season row — can use the same button without inventing the fields it lacks.
 */
export type CalendarSource = Pick<
  SeasonEvent,
  'id' | 'title' | 'date' | 'endDate' | 'startTime' | 'endTime' | 'location' | 'notes'
>;

/**
 * Turn a season event into the shape the calendar builders want.
 *
 * The UID is the event's own row id, so a personal copy taken from the app and
 * an invite that arrives later by email are the same entry to a calendar client
 * — the second one updates the first instead of sitting beside it.
 */
export function toCalendarEvent(
  event: CalendarSource,
  opts: { teamName?: string; url?: string } = {},
): CalendarEvent {
  const notes = [event.notes, opts.teamName ? `Team: ${opts.teamName}` : undefined]
    .filter(Boolean)
    .join('\n');
  return {
    uid: `season-event-${event.id}@tryouthq.ca`,
    title: opts.teamName ? `${event.title} (${opts.teamName})` : event.title,
    date: event.date,
    endDate: event.endDate,
    startTime: event.startTime || undefined,
    endTime: event.endTime || undefined,
    location: event.location || undefined,
    description: notes || undefined,
    url: opts.url,
  };
}

// Brand spot-colors, used only as small identifying accents on the provider
// badges below — everything else in the menu stays on theme tokens so it still
// reads correctly in both light and dark.
const GOOGLE_BLUE = '#4285F4';
const OUTLOOK_BLUE = '#0078D4';

/** A small round icon/letter mark identifying a calendar provider. */
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
 * "Add to calendar" for one event.
 *
 * Google and Outlook get web deep links; everything else — Apple Calendar,
 * Outlook desktop, Thunderbird, work calendars behind SSO — is served by the
 * .ics download, which is why it sits last rather than as a fourth brand.
 *
 * The menu positions itself with `fixed` coordinates computed from the
 * trigger button's own rect, clamped to the viewport — not plain `absolute
 * right-0`, which reads fine on a wide screen but renders partly off-canvas
 * the moment this sits inside a narrow card (a two-column event grid, a
 * guardian portal card on mobile width), cutting the provider names in half.
 *
 * Worth knowing about the copy this makes: it is a snapshot. If the coach later
 * moves the event, the entry already sitting in a personal calendar does not
 * follow, because nothing here subscribes to anything. The emailed invite is the
 * path that *can* update in place (same UID, higher SEQUENCE) — this button is
 * for someone who wants the event now, off a screen they are already looking at.
 */
export function AddToCalendar({
  event,
  teamName,
  size = 'md',
}: {
  event: CalendarSource;
  teamName?: string;
  size?: 'sm' | 'md';
}) {
  const colors = useThemeColors();
  const [open, setOpen] = useState(false);
  // null while unmeasured — the menu renders invisibly at this point purely to
  // get a real bounding rect out of the browser, then snaps to its real,
  // viewport-clamped spot before paint (useLayoutEffect runs before the
  // browser draws the frame, so there is no visible jump).
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

  const calendarEvent = toCalendarEvent(event, { teamName });
  const googleUrl = googleCalendarUrl(calendarEvent);
  const outlookPersonalUrl = outlookCalendarUrl(calendarEvent);
  const outlookWorkUrl = outlookCalendarUrl(calendarEvent, 'office');

  const pad = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm';

  // A CSS variable rather than per-row hover state — every menu row can share
  // one `hover:bg-[var(--menu-hover)]` class even though the actual color is a
  // theme token that changes with light/dark.
  const menuStyle: CSSProperties & Record<'--menu-hover', string> = {
    backgroundColor: colors.card,
    border: `1px solid ${colors.borderStrong}`,
    boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
    '--menu-hover': colors.tile,
  };

  const itemClass =
    'flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-[var(--menu-hover)]';

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-lg font-semibold transition-colors ${pad}`}
        style={{
          backgroundColor: open ? colors.primarySoft : colors.tile,
          color: colors.ink,
          border: `1px solid ${open ? colors.primary : colors.border}`,
        }}
      >
        <Icon name="calendar" size={size === 'sm' ? 13 : 15} color={colors.primary} />
        Add to calendar
        <Icon
          name="chevronDown"
          size={size === 'sm' ? 12 : 14}
          color={colors.inkMuted}
          strokeWidth={2.5}
        />
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          className="fixed z-50 w-72 rounded-2xl p-1.5 transition-opacity duration-100"
          style={{ ...menuStyle, top: pos?.top ?? 0, left: pos?.left ?? 0, opacity: pos ? 1 : 0 }}
        >
          <a
            role="menuitem"
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={itemClass}
          >
            <ProviderBadge bg={`${GOOGLE_BLUE}26`} fg={GOOGLE_BLUE}>
              G
            </ProviderBadge>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold" style={{ color: colors.ink }}>
                Google Calendar
              </span>
              <span className="block text-[11px]" style={{ color: colors.inkMuted }}>
                Opens in a new tab
              </span>
            </span>
            <Icon name="chevronRight" size={14} color={colors.inkFaint} />
          </a>

          {/* Personal and work/school share one row — two separate full rows for the
              same brand read as a near-duplicate and was most of what made this
              menu feel cluttered rather than just tall. */}
          <div className={itemClass} style={{ cursor: 'default' }}>
            <ProviderBadge bg={`${OUTLOOK_BLUE}26`} fg={OUTLOOK_BLUE}>
              O
            </ProviderBadge>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold" style={{ color: colors.ink }}>
                Outlook
              </span>
              <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-semibold">
                <a
                  role="menuitem"
                  href={outlookPersonalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="underline decoration-dotted underline-offset-2 hover:opacity-80"
                  style={{ color: colors.primary }}
                >
                  Personal
                </a>
                <a
                  role="menuitem"
                  href={outlookWorkUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="underline decoration-dotted underline-offset-2 hover:opacity-80"
                  style={{ color: colors.primary }}
                >
                  Work / school
                </a>
              </span>
            </span>
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              downloadIcs(calendarEvent);
              setOpen(false);
            }}
            className={itemClass}
          >
            <ProviderBadge bg={colors.tile} fg={colors.primary}>
              <Icon name="export" size={15} />
            </ProviderBadge>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold" style={{ color: colors.ink }}>
                Apple Calendar / other
              </span>
              <span className="block text-[11px]" style={{ color: colors.inkMuted }}>
                Downloads an .ics file
              </span>
            </span>
          </button>
        </div>
      ) : null}
    </>
  );
}
