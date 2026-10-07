'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  DateField,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Select,
  Textarea,
  TimeField,
  useAlert,
} from '@/components/ui';
import { FounderNotAvailable, FounderSection } from '@/components/founder/FounderUi';
import { SEVERITY_BADGE, SEVERITY_OPTIONS, formatDate } from '@/components/founder/labels';
import type { AnnouncementSeverity, PlatformAnnouncement } from '@/data/founder/types';
import {
  useAnnouncementsQuery,
  useCreateAnnouncementMutation,
  useEmailAnnouncementMutation,
  useEndAnnouncementMutation,
  useIsFounderQuery,
} from '@/features/founderQueries';

const EMPTY_FORM = {
  title: '',
  message: '',
  severity: 'warning' as AnnouncementSeverity,
  endDate: '',
  endTime: '',
  email: false,
};

export default function FounderAnnouncementsPage() {
  const founderQuery = useIsFounderQuery();
  if (founderQuery.isLoading) return <LoadingState message="Loading..." />;
  if (founderQuery.data !== true) return <FounderNotAvailable />;
  return <Announcements />;
}

function Announcements() {
  const query = useAnnouncementsQuery();
  const announcements = query.data ?? [];
  // Live-ness as of the last read; ending one refetches, so this stays current.
  const now = query.dataUpdatedAt;
  const live = announcements.filter((a) => a.startsAt <= now && (!a.endsAt || a.endsAt > now));
  const past = announcements.filter((a) => !live.includes(a));

  return (
    <>
      <PageHeader title="Announcements" subtitle="A banner for every signed-in user, optionally emailed to every organization" />
      <ComposeAnnouncement />

      {query.isLoading ? (
        <LoadingState message="Loading announcements..." />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Could not load announcements.'}
          onRetry={() => query.refetch()}
        />
      ) : announcements.length === 0 ? (
        <EmptyState title="No announcements yet" message="Anything posted above shows here." />
      ) : (
        <>
          <FounderSection title={`Live (${live.length})`}>
            {live.length ? (
              live.map((a) => <AnnouncementRow key={a.id} announcement={a} live />)
            ) : (
              <p className="text-sm">Nothing is showing right now.</p>
            )}
          </FounderSection>
          {past.length ? (
            <FounderSection title="Ended">
              {past.map((a) => (
                <AnnouncementRow key={a.id} announcement={a} live={false} />
              ))}
            </FounderSection>
          ) : null}
        </>
      )}
    </>
  );
}

function ComposeAnnouncement() {
  const { alert, confirm, toast } = useAlert();
  const create = useCreateAnnouncementMutation();
  const emailIt = useEmailAnnouncementMutation();
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<'title' | 'message' | 'end', string>>>({});

  const set = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async () => {
    // Date and time are the founder's local time; toISOString() carries the offset to the server.
    const endsAt = form.endDate ? new Date(`${form.endDate}T${form.endTime || '23:59'}`) : null;
    const next = {
      title: form.title.trim() ? undefined : 'Required',
      message: form.message.trim() ? undefined : 'Required',
      end: endsAt && endsAt.getTime() <= Date.now() ? 'Must be in the future' : undefined,
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    if (form.email) {
      const ok = await confirm({
        title: 'Email Every Organization?',
        message: `"${form.title.trim()}" will be emailed to the owners and admins of every active organization. This can't be unsent.`,
        confirmLabel: 'Post & Email',
        destructive: true,
      });
      if (!ok) return;
    }

    try {
      const id = await create.mutateAsync({
        title: form.title,
        message: form.message,
        severity: form.severity,
        endsAt: endsAt?.toISOString(),
      });
      setForm(EMPTY_FORM);
      setErrors({});
      if (!form.email) {
        toast('Announcement posted.', 'success');
        return;
      }
      try {
        const sent = await emailIt.mutateAsync(id);
        toast(`Announcement posted and emailed to ${sent} ${sent === 1 ? 'person' : 'people'}.`, 'success');
      } catch (e) {
        await alert(
          'Posted, but Email Failed',
          `The banner is live. ${e instanceof Error ? e.message : 'The email could not be sent.'}`,
        );
      }
    } catch (e) {
      await alert('Could Not Post', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  return (
    <Card className="mb-6 flex flex-col gap-4">
      <Input
        label="Title"
        value={form.title}
        onChange={(e) => set('title', e.target.value)}
        error={errors.title}
        placeholder="e.g. Scheduled maintenance tonight"
        maxLength={120}
      />
      <Textarea
        label="Message"
        value={form.message}
        onChange={(e) => set('message', e.target.value)}
        error={errors.message}
        rows={3}
        maxLength={2000}
        placeholder="e.g. SquadOwl will be unavailable 11pm–midnight ET while we upgrade the database."
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Select
          label="Severity"
          value={form.severity}
          onChange={(e) => set('severity', e.target.value as AnnouncementSeverity)}
          options={SEVERITY_OPTIONS}
        />
        <DateField label="Hide after (optional)" value={form.endDate} onChange={(v) => set('endDate', v)} disablePast error={errors.end} />
        <TimeField label="Time" value={form.endTime} onChange={(v) => set('endTime', v)} disabled={!form.endDate} />
      </div>
      <Checkbox
        checked={form.email}
        onChange={(v) => set('email', v)}
        label="Also email the owners and admins of every active organization"
      />
      <div>
        <Button label="Post Announcement" loading={create.isPending || emailIt.isPending} onClick={submit} />
      </div>
    </Card>
  );
}

function AnnouncementRow({ announcement: a, live }: { announcement: PlatformAnnouncement; live: boolean }) {
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const end = useEndAnnouncementMutation();
  const emailIt = useEmailAnnouncementMutation();
  const badge = SEVERITY_BADGE[a.severity];

  const handleEnd = async () => {
    const ok = await confirm({ title: 'End Announcement', message: `Stop showing "${a.title}" to everyone?`, confirmLabel: 'End' });
    if (!ok) return;
    try {
      await end.mutateAsync(a.id);
      toast('Announcement ended.', 'success');
    } catch (e) {
      await alert('Could Not End', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const handleEmail = async () => {
    const ok = await confirm({
      title: 'Email Every Organization?',
      message: `"${a.title}" will be emailed to the owners and admins of every active organization. This can't be unsent.`,
      confirmLabel: 'Send Email',
      destructive: true,
    });
    if (!ok) return;
    try {
      const sent = await emailIt.mutateAsync(a.id);
      toast(`Emailed to ${sent} ${sent === 1 ? 'person' : 'people'}.`, 'success');
    } catch (e) {
      await alert('Could Not Email', e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="font-bold break-words" style={{ color: colors.ink }}>
          {a.title}
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge label={badge.label} variant={badge.variant} />
          {a.emailedAt ? <Badge label={`Emailed to ${a.emailRecipientCount ?? 0}`} variant="success" /> : null}
        </div>
      </div>
      <p className="text-sm break-words whitespace-pre-line" style={{ color: colors.inkMuted }}>
        {a.message}
      </p>
      <p className="text-xs" style={{ color: colors.inkFaint }}>
        Posted {formatDate(a.createdAt, true)}
        {a.endsAt ? ` · ${live ? 'hides' : 'ended'} ${formatDate(a.endsAt, true)}` : ' · until ended'}
        {a.emailedAt ? ` · emailed ${formatDate(a.emailedAt, true)}` : ''}
      </p>
      {live ? (
        <div className="flex flex-wrap gap-2">
          <Button label="End Now" size="sm" variant="secondary" loading={end.isPending} onClick={handleEnd} />
          {!a.emailedAt ? (
            <Button label="Email Organizations" size="sm" variant="ghost" loading={emailIt.isPending} onClick={handleEmail} />
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
