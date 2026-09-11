'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

import { AddToCalendar } from '@/components/AddToCalendar';
import { MapLink } from '@/components/MapLink';
import { Card, LoadingState, ThemeToggle } from '@/components/ui';
import { SupabaseDataSource } from '@/data/supabase/SupabaseDataSource';
import type { EventRsvpContext } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';

const ds = new SupabaseDataSource();

const RESPONSES = ['yes', 'maybe', 'no'] as const;
type Response = (typeof RESPONSES)[number];

function isResponse(v: string | null): v is Response {
  return !!v && (RESPONSES as readonly string[]).includes(v);
}

const ANSWER_LABEL: Record<Response, string> = {
  yes: 'Going',
  maybe: 'Maybe',
  no: 'Not going',
};

/** "18:00" → "6:00 PM"; anything else is shown as typed. */
function prettyTime(value?: string): string | undefined {
  if (!value) return undefined;
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!m) return value;
  const h = Number(m[1]);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "2026-09-15" → "Tue, Sep 15, 2026", built in UTC so the date never shifts. */
function prettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The landing page for an RSVP link out of a schedule email.
 *
 * Unauthenticated by design — the token in the URL is the whole credential, and
 * the guardians this is for very often have no account. It reaches Supabase
 * through two anon RPCs that see only the one event and the one player the token
 * was issued for.
 *
 * `?r=yes|maybe|no` (what the email's buttons carry) is answered on arrival, so
 * a guardian's tap is one round trip and they land on a confirmation rather than
 * a second set of buttons. Without it — someone revisiting the bare link later —
 * the page just shows the event and asks.
 */
export default function RsvpPage() {
  const routeParams = useParams();
  const token = Array.isArray(routeParams?.token)
    ? routeParams.token[0]
    : (routeParams?.token as string | undefined);
  const searchParams = useSearchParams();
  const colors = useThemeColors();

  const [context, setContext] = useState<EventRsvpContext | null>(null);
  // Seeded from whether there is anything to load, so the effect below never has
  // to setState synchronously to short-circuit a missing token.
  const [loading, setLoading] = useState(Boolean(token));
  const [saving, setSaving] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answered, setAnswered] = useState(false);

  const answer = useCallback(
    async (response: Response) => {
      if (!token) return;
      setSaving(response);
      setError(null);
      try {
        setContext(await ds.submitEventRsvp(token, response));
        setAnswered(true);
      } catch (e) {
        // Whatever came back is a backend message — a Postgres error string in
        // the worst case. The recipient here is a guardian who did not ask for
        // schema detail, so keep it to something actionable and log the rest.
        console.error('Failed to submit RSVP', e);
        setError('Could not save your response. Please try again.');
      } finally {
        setSaving(null);
      }
    },
    [token],
  );

  // The `?r=` in the email's buttons is acted on once, on arrival. Guarded by a
  // ref rather than state: in development React mounts effects twice, and
  // without this the same answer is submitted twice.
  const autoSubmitted = useRef(false);

  useEffect(() => {
    if (!token) return;
    if (autoSubmitted.current) return;
    autoSubmitted.current = true;

    const requested = searchParams.get('r');

    (async () => {
      try {
        if (isResponse(requested)) {
          setContext(await ds.submitEventRsvp(token, requested));
          setAnswered(true);
        } else {
          const ctx = await ds.getEventRsvpContext(token);
          if (!ctx) {
            setError('This RSVP link is no longer valid. The event may have been deleted.');
          } else {
            setContext(ctx);
          }
        }
      } catch (e) {
        console.error('Failed to open RSVP link', e);
        setError('We could not open this RSVP link. It may have expired, or the event may have been removed.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token, searchParams]);

  const shell = (children: React.ReactNode) => (
    <div
      className="relative min-h-dvh px-4"
      style={{
        backgroundColor: colors.bg,
        paddingTop: 'calc(2.5rem + env(safe-area-inset-top, 0px))',
        paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div
        className="absolute"
        style={{
          top: 'calc(1.25rem + env(safe-area-inset-top, 0px))',
          right: 'calc(1.25rem + env(safe-area-inset-right, 0px))',
        }}
      >
        <ThemeToggle />
      </div>
      <div className="mx-auto w-full max-w-[520px]">{children}</div>
    </div>
  );

  if (loading) return shell(<LoadingState message="Opening your invitation..." />);

  if (!context) {
    return shell(
      <Card className="mt-10 text-center">
        <h1 className="text-xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          Link not available
        </h1>
        <p className="mt-3 text-[15px]" style={{ color: colors.inkMuted }}>
          {token
            ? (error ?? 'This RSVP link could not be opened.')
            : 'This RSVP link is missing its code. Please open the link from your email again.'}
        </p>
        <p className="mt-3 text-sm" style={{ color: colors.inkFaint }}>
          You can still RSVP from the team portal, or reply to your coach directly.
        </p>
      </Card>,
    );
  }

  const time = prettyTime(context.startTime);
  const endTime = prettyTime(context.endTime);
  const current = context.response;

  return shell(
    <>
      {/* Right padding keeps a long player name clear of the theme toggle
          floating in the corner, which it otherwise wraps underneath. */}
      <h1
        className="pr-12 text-2xl font-bold"
        style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}
      >
        {answered ? 'Thanks — that’s saved' : `Can ${context.playerName} make it?`}
      </h1>
      <p className="mt-2 text-[15px]" style={{ color: colors.inkMuted }}>
        {answered ? (
          <>
            <strong style={{ color: colors.ink }}>{context.playerName}</strong> is marked as{' '}
            <strong style={{ color: current === 'no' ? colors.danger : colors.success }}>
              {ANSWER_LABEL[current as Response] ?? current}
            </strong>
            . Your coach can see it now.
          </>
        ) : (
          'Let the coaching staff know so they can plan the session.'
        )}
      </p>

      <Card className="mt-5 flex flex-col gap-1">
        <span className="text-lg font-bold" style={{ color: colors.ink }}>
          {context.title}
        </span>
        <span className="text-sm font-semibold" style={{ color: colors.primary }}>
          {context.teamName} · {context.seasonName}
        </span>
        <span className="mt-2 text-[15px]" style={{ color: colors.inkMuted }}>
          {prettyDate(context.date)}
          {time ? ` · ${time}` : ''}
          {endTime ? ` – ${endTime}` : ''}
        </span>
        {context.location ? (
          <span className="text-[15px]" style={{ color: colors.inkMuted }}>
            <MapLink location={context.location} label={context.title} variant="inline" />
          </span>
        ) : null}
        {context.notes ? (
          <span className="mt-2 whitespace-pre-line text-sm" style={{ color: colors.inkFaint }}>
            {context.notes}
          </span>
        ) : null}
      </Card>

      <Card className="mt-3">
        <p className="mb-2 text-sm font-bold" style={{ color: colors.inkMuted }}>
          {answered ? 'Changed your mind?' : 'Your answer'}
        </p>
        <div className="flex gap-2">
          {RESPONSES.map((r) => {
            const active = current === r;
            const bg = r === 'yes' ? colors.success : r === 'maybe' ? colors.warning : colors.danger;
            return (
              <button
                key={r}
                type="button"
                onClick={() => answer(r)}
                disabled={saving !== null}
                className="flex-1 rounded-md py-2.5 text-center font-bold disabled:opacity-50"
                style={{
                  backgroundColor: active ? bg : colors.tile,
                  color: active ? '#fff' : colors.ink,
                }}
              >
                {saving === r ? 'Saving...' : ANSWER_LABEL[r]}
              </button>
            );
          })}
        </div>
        {error ? (
          <p className="mt-3 text-sm font-semibold" style={{ color: colors.danger }}>
            {error}
          </p>
        ) : null}
      </Card>

      <Card className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm" style={{ color: colors.inkMuted }}>
          Keep this event handy
        </span>
        <MapLink location={context.location} label={context.title} />
        <AddToCalendar
          event={{
            id: context.eventId,
            title: context.title,
            date: context.date,
            startTime: context.startTime,
            endTime: context.endTime,
            location: context.location,
            notes: context.notes,
          }}
          teamName={context.teamName}
        />
      </Card>
    </>,
  );
}
