'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
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
  useUpdateTryoutMutation,
  useArchiveTryoutMutation,
  useDeleteTryoutMutation,
  useCopyTryoutMutation,
} from '@/features/queries';
import { getDataSource } from '@/data';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { getDefaultRubrics } from '@/data/rubrics';
import type { Assessor } from '@/data/types';

export default function SettingsPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const welcome = useSearchParams().get('welcome');
  const colors = useThemeColors();
  const router = useRouter();
  const { alert, confirm, toast } = useAlert();
  const welcomedRef = useRef(false);
  const tryoutQuery = useTryoutQuery(id);
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
  const [name, setName] = useState('');
  const [tryoutDate, setTryoutDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [rink, setRink] = useState('');

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
  const rubrics = getDefaultRubrics(tryout.sport);

  const openEdit = () => {
    setName(tryout.name);
    setTryoutDate(tryout.tryoutDate ?? '');
    setStartTime(tryout.startTime ?? '');
    setRink(tryout.rink ?? '');
    setShowEdit(true);
  };

  const saveEdit = async () => {
    await updateTryout.mutateAsync({
      id: tryout.id,
      updates: {
        name: name.trim() || tryout.name,
        tryoutDate: tryoutDate.trim() || undefined,
        startTime: startTime.trim() || undefined,
        rink: rink.trim() || undefined,
      },
    });
    setShowEdit(false);
  };

  const inviteLink = (assessor: { name: string }) =>
    `https://aas-tryout.app/assess?event=${tryout.cloud?.id ?? tryout.id}&assessor=${encodeURIComponent(assessor.name)}`;

  const shareAssessorInvite = async (assessor: { name: string; email?: string }) => {
    if (assessor.email) {
      try {
        await getDataSource().sendEmail('tryout_invite', assessor.email, { role: 'assessor' });
        await alert('Invitation Sent', `An invitation email has been successfully sent to ${assessor.email}.`);
        return;
      } catch (err) {
        console.error('Error sending email via Supabase', err);
        await alert('Email Failed', 'Could not send the email automatically — the invite link was copied instead.');
      }
    }
    try {
      await navigator.clipboard.writeText(
        `${assessor.name}, you've been invited to score ${tryout.name}. Open: ${inviteLink(assessor)}`,
      );
      toast('Invite link copied to clipboard', 'success');
    } catch {
      await alert('Invite link', inviteLink(assessor));
    }
  };

  const addAssessor = async () => {
    if (!assessorName.trim()) return;
    const emailToInvite = assessorEmail.trim();

    if (!emailToInvite) {
      await alert('Email Required', 'You must provide a valid email address for the assessor.');
      return;
    }

    setAddingAssessor(true);
    try {
      const exists = await getDataSource().checkUserExistsByEmail(emailToInvite);
      if (!exists) {
        await alert(
          'Email Not Registered',
          'This email is not registered in the system. Assessors must create an account before they can be invited.',
        );
        return;
      }

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
    await updateTryout.mutateAsync({ id: tryout.id, updates: { assessors: newAssessors } });
  };

  const handleCopy = async () => {
    const copy = await copyTryout.mutateAsync(tryout.id);
    router.push(`/assessment/${copy.id}/roster`);
  };

  const handleArchive = async () => {
    await archiveTryout.mutateAsync(tryout.id);
    router.replace('/dashboard');
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Delete Assessment',
      message:
        'Are you sure you want to delete this assessment? This action cannot be undone and will delete all associated data.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteTryout.mutateAsync(tryout.id);
    router.replace('/dashboard');
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card accent className="flex flex-col items-start gap-2">
        <span className="text-lg font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          {tryout.name}
        </span>
        <span style={{ color: colors.inkMuted }}>
          {tryout.sport} · {tryout.eventType}
        </span>
        {tryout.tryoutDate ? (
          <span style={{ color: colors.inkFaint }}>
            {tryout.tryoutDate} {tryout.startTime ? `· ${tryout.startTime}` : ''} {tryout.rink ? `· ${tryout.rink}` : ''}
          </span>
        ) : null}
        {tryout.cloud?.id ? <Badge label={`Code: ${tryout.cloud.id}`} variant="brand" /> : null}
        <Button label="Edit Details" variant="secondary" size="sm" onClick={openEdit} />
      </Card>

      <Card className="flex flex-col gap-3">
        <SectionLabel>Rubrics</SectionLabel>
        <span className="text-sm" style={{ color: colors.inkMuted }}>
          {rubrics.skater.length} skater + {rubrics.goalie.length} goalie reference categories
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
            className="flex flex-wrap items-start justify-between gap-3 border-b py-2"
            style={{ borderColor: colors.border }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold" style={{ color: colors.ink }}>
                {a.name}
              </p>
              {a.email ? (
                <p className="mt-0.5 text-sm" style={{ color: colors.inkMuted }}>
                  {a.email}
                </p>
              ) : null}
              <div className="mt-2 flex gap-1.5">
                {a.role !== 'lead' ? (
                  <Badge label={a.status || 'pending'} variant={a.status === 'accepted' ? 'brand' : 'default'} />
                ) : null}
                <Badge label={a.role} />
              </div>
            </div>

            {a.role !== 'lead' ? (
              <div className="flex gap-2">
                <Button
                  label={a.status === 'pending' ? 'Send Invite' : 'Send Reminder'}
                  size="sm"
                  variant="secondary"
                  onClick={() => (a.status === 'pending' ? shareAssessorInvite(a) : sendReminder(a))}
                />
                <Button label="Remove" size="sm" variant="ghost" onClick={() => removeAssessor(i)} />
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
        <Button label="Copy Assessment" variant="secondary" onClick={handleCopy} loading={copyTryout.isPending} />
      </Card>

      <Card className="flex flex-col items-start gap-2">
        <SectionLabel className="!text-[color:var(--c-danger)]">Danger Zone</SectionLabel>
        <div className="flex flex-wrap gap-2">
          <Button
            label="Archive Assessment"
            variant="danger"
            onClick={handleArchive}
            loading={archiveTryout.isPending}
          />
          <Button label="Delete Assessment" variant="danger" onClick={handleDelete} loading={deleteTryout.isPending} />
        </div>
      </Card>

      <Modal visible={showEdit} title="Edit Assessment" onClose={() => setShowEdit(false)} hideDefaultFooter>
        <div className="flex flex-col gap-3">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <DateField label="Date" value={tryoutDate} onChange={setTryoutDate} />
          <TimeField label="Start Time" value={startTime} onChange={setStartTime} />
          <Input label="Location" value={rink} onChange={(e) => setRink(e.target.value)} placeholder="Rink A" />
          <Button label="Save" onClick={saveEdit} loading={updateTryout.isPending} />
        </div>
      </Modal>

      <Modal visible={showRubrics} title="Rubric Reference" onClose={() => setShowRubrics(false)}>
        <p className="mb-2 text-sm font-bold" style={{ color: colors.primary }}>
          Skater Categories
        </p>
        {rubrics.skater.map((r) => (
          <div key={r.key} className="mb-2">
            <p className="text-base" style={{ color: colors.ink }}>
              {r.label}
            </p>
            <p className="text-sm" style={{ color: colors.inkMuted }}>
              {r.subskills.map((s) => s.label).join(', ')}
            </p>
          </div>
        ))}
        {rubrics.goalie.length > 0 ? (
          <>
            <p className="mb-2 mt-4 text-sm font-bold" style={{ color: colors.primary }}>
              Goalie Categories
            </p>
            {rubrics.goalie.map((r) => (
              <div key={r.key} className="mb-2">
                <p className="text-base" style={{ color: colors.ink }}>
                  {r.label}
                </p>
                <p className="text-sm" style={{ color: colors.inkMuted }}>
                  {r.subskills.map((s) => s.label).join(', ')}
                </p>
              </div>
            ))}
          </>
        ) : null}
      </Modal>

      <Modal visible={showAssessor} title="Add Assessor" onClose={() => setShowAssessor(false)} hideDefaultFooter>
        <div className="flex flex-col gap-3">
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            Assessors must have a registered account in the app before they can be invited.
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
    </div>
  );
}
