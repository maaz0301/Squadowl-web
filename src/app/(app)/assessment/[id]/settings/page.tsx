'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { useRouter, useSearchParams } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { MapLink, MapLocationHint } from '@/components/MapLink';
import {
  Badge,
  Button,
  Card,
  DateField,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  SectionLabel,
  TimeField,
  useAlert,
} from '@/components/ui';
import {
  useTryoutQuery,
  useAssessmentCountQuery,
  useUpdateTryoutMutation,
  useArchiveTryoutMutation,
  useDeleteTryoutMutation,
  useCopyTryoutMutation,
} from '@/features/queries';
import { getDataSource } from '@/data';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { END_BEFORE_START_MESSAGE, isEndAfterStart } from '@/data/timeRange';
import type { Assessor } from '@/data/types';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { isAtAssessmentLimit } from '@/data/plans';
import { APP_CONFIG } from '@/config/app';
import { buildLimitReachedMessage } from '@/lib/usageNudges';
import { INVITE_STATUS } from '@/lib/assessorInvite';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { CoachOnlyState } from '@/components/assessment/CoachOnlyState';

export default function SettingsPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const welcome = useSearchParams().get('welcome');
  const colors = useThemeColors();
  const router = useRouter();
  const { alert, confirm, toast } = useAlert();
  const welcomedRef = useRef(false);
  const tryoutQuery = useTryoutQuery(id);
  // A team someone else owns is run on that team's plan, not the viewer's own.
  const effectiveTier = useEffectivePlanTier(tryoutQuery.data?.teamId);
  // Just the number, for the copy-assessment plan check. This used to be
  // useTryoutsQuery(false) — every roster, evaluation, score and registration
  // in the account fetched on arrival so one `.length` could be read off it.
  const assessmentCount = useAssessmentCountQuery();
  const updateTryout = useUpdateTryoutMutation();
  const archiveTryout = useArchiveTryoutMutation();
  const deleteTryout = useDeleteTryoutMutation();
  const copyTryout = useCopyTryoutMutation();
  const [showRubrics, setShowRubrics] = useState(false);
  const [showAssessor, setShowAssessor] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [assessorName, setAssessorName] = useState('');
  const [assessorEmail, setAssessorEmail] = useState('');
  const [addingAssessor, setAddingAssessor] = useState(false);
  const [busyAssessor, setBusyAssessor] = useState<{ index: number; action: 'invite' | 'remove' } | null>(null);
  const [name, setName] = useState('');
  const [tryoutDate, setTryoutDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [endTimeError, setEndTimeError] = useState('');
  const [rink, setRink] = useState('');
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  useEffect(() => {
    if (welcome === '1' && !welcomedRef.current) {
      welcomedRef.current = true;
      setShowAssessor(true);
    }
  }, [welcome]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading settings..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load settings." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  if (!tryout.viewerIsOwner) return <CoachOnlyState what="change or delete this evaluation" />;
  // Templates were removed — every rubric is custom, so this is the whole set.
  const rubrics = tryout.settings.customRubrics ?? [];

  const openEdit = () => {
    setName(tryout.name);
    setTryoutDate(tryout.tryoutDate ?? '');
    setStartTime(tryout.startTime ?? '');
    setEndTime(tryout.endTime ?? '');
    setEndTimeError('');
    setRink(tryout.rink ?? '');
    setShowEdit(true);
  };

  const saveEdit = async () => {
    if (!isEndAfterStart(startTime, endTime)) {
      setEndTimeError(END_BEFORE_START_MESSAGE);
      return;
    }
    setEndTimeError('');
    await updateTryout.mutateAsync({
      id: tryout.id,
      updates: {
        name: name.trim() || tryout.name,
        tryoutDate: tryoutDate.trim() || undefined,
        startTime: startTime.trim() || undefined,
        endTime: endTime.trim() || undefined,
        rink: rink.trim() || undefined,
      },
    });
    setShowEdit(false);
  };

  // The invite is claimed by e-mail address, not by a token in the URL: the
  // database links a tryout_assessors row to whoever signs in with the address
  // it was addressed to (link_assessor_to_user on insert, handle_new_user on
  // signup). So the link only has to land the invitee on the sign-in screen
  // with the right context — it deliberately carries no identifying details.
  const inviteLink = () => {
    const base =
      APP_CONFIG.webUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://www.tryouthq.ca');
    return `${base}/login?invite=assessor`;
  };

  const shareAssessorInvite = async (assessor: { name: string; email?: string }) => {
    if (assessor.email) {
      try {
        await getDataSource().sendEmail('tryout_invite', assessor.email, {
          role: 'assessor',
          tryoutName: tryout.name,
          inviteUrl: inviteLink(),
        });
        await alert(
          'Invitation Sent',
          `An invitation email has been sent to ${assessor.email}. They can accept it after signing in — or after creating an account with that address if they don't have one yet.`,
        );
        return;
      } catch (err) {
        console.error('Error sending email via Supabase', err);
        await alert('Email Failed', 'Could not send the email automatically — the invite link was copied instead.');
      }
    }
    try {
      await navigator.clipboard.writeText(
        `${assessor.name}, you've been invited to score ${tryout.name}. Sign in (or create an account) with this email address to accept: ${inviteLink()}`,
      );
      toast('Invite link copied to clipboard', 'success');
    } catch {
      await alert('Invite link', inviteLink());
    }
  };

  const addAssessor = async () => {
    const emailToInvite = assessorEmail.trim();

    // Was a silent return for a blank name, which looks like a dead button.
    if (!assessorName.trim() || !emailToInvite) {
      await alert('Missing Info', 'An assessor needs both a name and an email address.');
      return;
    }

    if (!z.string().email().safeParse(emailToInvite).success) {
      await alert('Invalid Email', `"${emailToInvite}" is not a valid email address.`);
      return;
    }

    // One row per address per tryout is a database constraint
    // (unique (tryout_id, email)), so catch the repeat here and say so rather
    // than letting the insert fail with a Postgres message.
    if (tryout.assessors.some((a) => a.email?.toLowerCase() === emailToInvite.toLowerCase())) {
      await alert('Already Invited', `${emailToInvite} is already on this evaluation's assessor list.`);
      return;
    }

    setAddingAssessor(true);
    try {
      // No "do they already have an account?" gate. An invite is addressed to
      // an email, and the database claims it for whoever signs up with that
      // address (handle_new_user in 0002_assessor_linking.sql), so requiring
      // the assessor to go and register first — with no prompt telling them to
      // — was a dead end the coach had no way past.
      const newAssessor: Assessor = {
        name: assessorName.trim(),
        email: emailToInvite,
        role: 'assessor',
        status: 'pending',
      };

      await updateTryout.mutateAsync({
        id: tryout.id,
        updates: { assessors: [...tryout.assessors, newAssessor] },
      });
      setAssessorName('');
      setAssessorEmail('');
      setShowAssessor(false);
      await shareAssessorInvite(newAssessor);
    } catch (e) {
      // Without this the whole handler was try/finally with no catch: a failing
      // checkUserExistsByEmail or updateTryout threw straight past
      // setShowAssessor(false) as an unhandled rejection, so the modal just sat
      // there with no error and no visible reason — which reads as "the modal
      // won't close". The modal deliberately stays open on failure so the entry
      // can be corrected and retried; what was missing was saying why.
      await alert('Error', e instanceof Error ? e.message : 'Could not add this assessor.');
    } finally {
      setAddingAssessor(false);
    }
  };

  const sendReminder = async (assessor: Assessor) => {
    if (!assessor.email) {
      await alert('No Email', 'This assessor does not have an email address attached.');
      return;
    }
    try {
      await getDataSource().sendEmail('reminder', assessor.email, {
        title: tryout.name,
        message: `This is a reminder that you have been assigned to assess players for ${tryout.name}. Please log in to complete your evaluations.`,
      });
      await alert('Reminder Sent', `Reminder successfully sent to ${assessor.name}.`);
    } catch (e) {
      await alert('Reminder Failed', e instanceof Error ? e.message : 'Could not send reminder.');
    }
  };

  const removeAssessor = async (index: number) => {
    const newAssessors = [...tryout.assessors];
    newAssessors.splice(index, 1);
    setBusyAssessor({ index, action: 'remove' });
    try {
      await updateTryout.mutateAsync({ id: tryout.id, updates: { assessors: newAssessors } });
    } catch (e) {
      // try/finally with no catch, same gap addAssessor had: a removal the
      // database refused threw straight past the spinner as an unhandled
      // rejection, so the row simply stayed on screen with nothing said about
      // why. The list is rebuilt from the re-read tryout either way — what was
      // missing was telling the coach the removal did not happen.
      await alert('Error', e instanceof Error ? e.message : 'Could not remove this assessor.');
    } finally {
      setBusyAssessor(null);
    }
  };

  const notifyAssessor = async (index: number, a: Assessor) => {
    setBusyAssessor({ index, action: 'invite' });
    try {
      if (a.status === 'pending') await shareAssessorInvite(a);
      else await sendReminder(a);
    } finally {
      setBusyAssessor(null);
    }
  };

  const handleCopy = async () => {
    const count = assessmentCount.data ?? 0;
    if (isAtAssessmentLimit(effectiveTier, count)) {
      setLimitMsg(buildLimitReachedMessage(effectiveTier, 'assessments', 'evaluations'));
      return;
    }
    const copy = await copyTryout.mutateAsync(tryout.id);
    router.push(`/assessment/${copy.id}/roster`);
  };

  const handleArchive = async () => {
    await archiveTryout.mutateAsync(tryout.id);
    router.replace('/dashboard');
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete Evaluation',
      message:
        'Are you sure you want to delete this evaluation? This action cannot be undone and will delete all associated data.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteTryout.mutateAsync(tryout.id);
      router.replace('/dashboard');
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not delete this evaluation.');
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card accent className="flex flex-col items-start gap-2">
        <span className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          {tryout.name}
        </span>
        <span style={{ color: colors.inkMuted }}>
          {tryout.sport} · {tryout.eventType}
        </span>
        {tryout.tryoutDate ? (
          <span style={{ color: colors.inkFaint }}>
            {tryout.tryoutDate}{' '}
            {tryout.startTime ? `· ${tryout.startTime}${tryout.endTime ? `–${tryout.endTime}` : ''}` : ''}{' '}
            {tryout.rink ? (
              <>
                {'· '}
                <MapLink location={tryout.rink} label={tryout.name} size="sm" variant="inline" />
              </>
            ) : null}
          </span>
        ) : null}
        {tryout.cloud?.id ? <Badge label={`Code: ${tryout.cloud.id}`} variant="brand" /> : null}
        <Button label="Edit Details" variant="secondary" size="sm" onClick={openEdit} />
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel>Rubrics</SectionLabel>
        <span className="text-sm" style={{ color: colors.inkMuted }}>
          {rubrics.length} {rubrics.length === 1 ? 'rubric' : 'rubrics'}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button
            label="Open Rubric Builder"
            variant="secondary"
            size="sm"
            onClick={() => router.push(href('rubrics'))}
          />
          <Button label="View Reference" variant="ghost" size="sm" onClick={() => setShowRubrics(true)} />
        </div>
      </Card>

      <Card className="flex flex-col gap-3 lg:col-span-2">
        <SectionLabel>Assessors ({tryout.assessors.length})</SectionLabel>
        {tryout.assessors.map((a, i) => (
          <div
            key={`${a.name}-${a.email}-${i}`}
            // Stacked on phones: side by side, the two action buttons never fit
            // beside a full email address, and the address (one unbreakable
            // token) ran straight under them.
            className="flex flex-col items-stretch gap-3 border-b py-2 sm:flex-row sm:items-start sm:justify-between"
            style={{ borderColor: colors.border }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold wrap-break-word" style={{ color: colors.ink }}>
                {a.name}
              </p>
              {a.email ? (
                <p className="mt-0.5 text-sm break-all" style={{ color: colors.inkMuted }}>
                  {a.email}
                </p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {a.role !== 'lead' ? <Badge {...INVITE_STATUS[a.status ?? 'pending']} /> : null}
                <Badge label={a.role} />
              </div>
            </div>

            {a.role !== 'lead' ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  className="flex-1 sm:flex-none"
                  label={a.status === 'pending' ? 'Resend Invite' : 'Send Reminder'}
                  size="sm"
                  variant="secondary"
                  loading={busyAssessor?.index === i && busyAssessor.action === 'invite'}
                  disabled={busyAssessor !== null && busyAssessor.index !== i}
                  onClick={() => notifyAssessor(i, a)}
                />
                <Button
                  className="flex-1 sm:flex-none"
                  label="Remove"
                  size="sm"
                  variant="ghost"
                  loading={busyAssessor?.index === i && busyAssessor.action === 'remove'}
                  disabled={busyAssessor !== null && busyAssessor.index !== i}
                  onClick={() => removeAssessor(i)}
                />
              </div>
            ) : null}
          </div>
        ))}
        <div>
          <Button label="+ Add Assessor" variant="secondary" size="sm" onClick={() => setShowAssessor(true)} />
        </div>
      </Card>

      <Card className="flex flex-col items-start gap-2">
        <SectionLabel>Duplicate</SectionLabel>
        <Button label="Copy Evaluation" variant="secondary" onClick={handleCopy} loading={copyTryout.isPending} />
      </Card>

      <Card className="flex flex-col items-start gap-2">
        <SectionLabel className="text-(--c-danger)!">Danger Zone</SectionLabel>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap">
          <Button
            label="Archive Evaluation"
            variant="danger"
            onClick={handleArchive}
            loading={archiveTryout.isPending}
          />
          <Button label="Delete Evaluation" variant="danger" onClick={handleDelete} loading={deleteTryout.isPending} />
        </div>
      </Card>

      <Modal visible={showEdit} title="Edit Evaluation" onClose={() => setShowEdit(false)} hideDefaultFooter>
        <div className="flex flex-col gap-3">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <DateField label="Date" value={tryoutDate} onChange={setTryoutDate} />
          <TimeField
            label="Start Time"
            value={startTime}
            onChange={(v) => {
              setStartTime(v);
              setEndTimeError('');
            }}
          />
          <TimeField
            label="End Time"
            value={endTime}
            onChange={(v) => {
              setEndTime(v);
              setEndTimeError('');
            }}
            error={endTimeError || undefined}
          />
          <div>
            <Input
              label="Location"
              value={rink}
              onChange={(e) => setRink(e.target.value)}
              placeholder="Rink A, 55 Bloor St W, Toronto"
            />
            <MapLocationHint location={rink} />
          </div>
          <Button label="Save" onClick={saveEdit} loading={updateTryout.isPending} />
        </div>
      </Modal>

      <Modal visible={showRubrics} title="Rubric Reference" onClose={() => setShowRubrics(false)}>
        {rubrics.length === 0 ? (
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            No rubrics yet. Open the Rubric Builder to add some.
          </p>
        ) : null}
        {rubrics.map((r) => (
          <div key={r.key} className="mb-2">
            <p className="text-base" style={{ color: colors.ink }}>
              {r.label}
            </p>
            {r.category ? (
              <p className="text-sm" style={{ color: colors.inkMuted }}>
                {r.category}
              </p>
            ) : null}
          </div>
        ))}
      </Modal>

      <Modal visible={showAssessor} title="Add Assessor" onClose={() => setShowAssessor(false)} hideDefaultFooter>
        <div className="flex flex-col gap-3">
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            They&apos;ll get an email invitation. If they don&apos;t have a TryoutHQ account yet, they can create one
            with this address and the invitation will be waiting for them.
          </p>
          <Input label="Name" value={assessorName} onChange={(e) => setAssessorName(e.target.value)} />
          <Input
            label="Email (Required)"
            type="email"
            value={assessorEmail}
            onChange={(e) => setAssessorEmail(e.target.value)}
          />
          <Button label="Add" onClick={addAssessor} loading={updateTryout.isPending || addingAssessor} />
        </div>
      </Modal>

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </div>
  );
}
