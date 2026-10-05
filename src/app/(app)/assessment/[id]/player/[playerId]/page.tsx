'use client';

import { useTerms } from '@/lib/terms';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { useThemeColors } from '@/theme/ThemeProvider';
import { usePermissions } from '@/state/authStore';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  SectionLabel,
  Spinner,
  useAlert,
} from '@/components/ui';
import {
  useTryoutQuery,
  useUpdatePlayerMutation,
  useDeletePlayerMutation,
  useAiPlayerSummaryMutation,
  useLinkGuardianMutation,
  useUnlinkGuardianMutation,
  useInviteMemberMutation,
  useResendInviteMutation,
  useCreateAndInviteMemberMutation,
  useUploadPlayerPhotoMutation,
  useFamilyContactsQuery,
  useAddFamilyContactMutation,
  useRemoveFamilyContactMutation,
  usePlayerLettersQuery,
  useResendPlayerLetterMutation,
  usePlayerReportCardsQuery,
} from '@/features/queries';
import { describeInvite, useInviteFamilyContact } from '@/features/useInviteFamilyContact';
import { useAssessmentHref, useAssessmentId, useIsAssessorOnly } from '@/features/useAssessmentId';
import { playerDisplayName, weightedOverall, getPlayerCategories, isGoaliePosition } from '@/data/rubrics';
import { AddPlayerForm, type ExtraFamilyContact } from '@/components/assessment/AddPlayerForm';
import { PlayerProfileSection } from '@/components/player/PlayerProfileSection';
import { formatBirth } from '@/lib/birthDate';
import { LETTER_KIND_LABELS } from '@/data/letters';
import { PlanGate } from '@/components/PlanGate';
import { PlayerLetterModal } from '@/components/player/PlayerLetterModal';
import { mockAiPlayerSummary } from '@/data/teamBuilder';

const AI_IDLE_TEXT = 'Generating...';
const AI_LOADING_TEXTS = ['Gathering data...', 'Ranking evaluations...', 'Analyzing strengths...', 'Finalizing insight...'];

export default function PlayerHubPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const params = useParams();
  const playerId = Array.isArray(params?.playerId) ? params.playerId[0] : (params?.playerId as string);
  const colors = useThemeColors();
  const router = useRouter();
  const { alert, confirm } = useAlert();

  const tryoutQuery = useTryoutQuery(id);
  const terms = useTerms(tryoutQuery.data?.settings.customLabels);
  // A hook, so it belongs above the early returns below rather than beside
  // the derived values it feeds.
  const isAssessorOnly = useIsAssessorOnly(tryoutQuery.data?.viewerIsOwner);
  const updatePlayer = useUpdatePlayerMutation(id!);
  const deletePlayer = useDeletePlayerMutation(id!);
  const uploadPhoto = useUploadPlayerPhotoMutation(id!);
  const aiSummary = useAiPlayerSummaryMutation(id!);

  const linkGuardianMut = useLinkGuardianMutation();
  const unlinkGuardianMut = useUnlinkGuardianMutation();
  const inviteMut = useInviteMemberMutation();
  const resendInviteMut = useResendInviteMutation();
  const createAndInviteMut = useCreateAndInviteMemberMutation();

  const [showEdit, setShowEdit] = useState(false);
  const [showLetter, setShowLetter] = useState(false);
  const [showGuardianLink, setShowGuardianLink] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiTextIndex, setAiTextIndex] = useState(0);

  // The interval is a real external-system subscription (a timer), so it
  // stays an effect — but nothing in the effect body sets state synchronously
  // on mount/dependency-change; the index only advances inside the interval
  // callback, and the idle case is handled by deriving aiLoadingText below
  // instead of resetting state here.
  useEffect(() => {
    if (!aiSummary.isPending) return;
    const int = setInterval(() => setAiTextIndex((i) => i + 1), 2500);
    return () => clearInterval(int);
  }, [aiSummary.isPending]);

  const aiLoadingText = aiSummary.isPending
    ? AI_LOADING_TEXTS[aiTextIndex % AI_LOADING_TEXTS.length]
    : AI_IDLE_TEXT;

  const player = tryoutQuery.data?.roster.find((p) => p.athleteId === playerId || p.id === playerId);
  const { canManageTeam, canAssess } = usePermissions();

  // Extra family members beyond the one guardian on the athlete row — added
  // here or from the Edit Player form, and by the guardian themselves from
  // their own portal. Not shown before now: this card is what surfaces them to
  // the coach at all.
  const familyContactsQuery = useFamilyContactsQuery(player?.athleteId);
  const addFamilyContactMut = useAddFamilyContactMutation(player?.athleteId ?? '');
  const removeFamilyContactMut = useRemoveFamilyContactMutation(player?.athleteId ?? '');
  const inviteContact = useInviteFamilyContact();
  const [showAddContact, setShowAddContact] = useState(false);
  const [contactName, setContactName] = useState('');
  const [contactRelationship, setContactRelationship] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [invitingContactId, setInvitingContactId] = useState<string | null>(null);

  // Letters sent to this player from the Letters tool — composing a new one
  // lives there (it needs the template picker across the whole roster), so
  // this card is a read-only history plus the re-send/retry a coach reaches
  // for right from the player they're looking at.
  const playerLettersQuery = usePlayerLettersQuery(id);
  const reportCardsQuery = usePlayerReportCardsQuery(player?.athleteId);
  const resendLetterMut = useResendPlayerLetterMutation(id!);
  // Filtered against the participant id (`player.id`), not the URL's
  // `playerId` param — that can be the athleteId instead (see the lookup
  // above), while a PlayerLetter's playerId is always the tryout_participants
  // row a copy is attached to.
  const playerLetters = (playerLettersQuery.data ?? [])
    .filter((l) => l.playerId === player?.id)
    .sort((a, b) => b.createdAt - a.createdAt);

  const categories = useMemo(() => {
    if (!tryoutQuery.data || !player) return [];
    return getPlayerCategories(tryoutQuery.data.sport, player.pos, tryoutQuery.data.settings.customRubrics);
  }, [tryoutQuery.data, player]);

  const weights = useMemo(() => {
    if (!tryoutQuery.data || !player) return {};
    return isGoaliePosition(player.pos)
      ? tryoutQuery.data.settings.goalieWeights
      : tryoutQuery.data.settings.skaterWeights;
  }, [tryoutQuery.data, player]);

  if (tryoutQuery.isLoading) return <LoadingState />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message={terms.t('Player not found.')} onRetry={() => tryoutQuery.refetch()} />;
  }
  if (!player) return <EmptyState title={terms.t('Player not found')} />;

  const tryout = tryoutQuery.data;
  // Two different questions, and both have to answer yes. canManageTeam reads
  // an account-wide role — it says nothing about *this* evaluation, and an
  // admin can perfectly well be an invited assessor on someone else's tryout.
  // isAssessorOnly is server-computed per tryout (Tryout.viewerIsOwner) and is
  // what says whether this viewer owns the evaluation in front of them. A
  // delegated team manager passes both (see usePermissions), so an evaluation
  // they created on their team reads exactly as the club owner's own does.
  const isCoachHere = canManageTeam && !isAssessorOnly;
  const evals = tryout.evals.filter((e) => e.playerId === playerId).sort((a, b) => b.createdAt - a.createdAt);
  const heuristic = mockAiPlayerSummary(tryout, playerId);
  const deepDive = tryout.aiAssessments?.[playerId];

  const runAi = async () => {
    try {
      await aiSummary.mutateAsync(playerId);
      setAiError(null);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'Failed to generate AI summary');
    }
  };

  const recreateGuardian = async () => {
    try {
      // Re-create the account first and only re-point the athlete's link once
      // that succeeds — linkGuardianMut overwrites whatever guardian_user_id
      // was there before in a single UPDATE, so there's no need to null it out
      // first. Unlinking up front used to mean a transient failure in the
      // create step left the athlete with no guardian link at all instead of
      // just keeping the old (still-broken) one until a retry succeeds.
      const defaultPassword = Math.random().toString(36).slice(-6) + 'Aa1!';
      const newMember = await createAndInviteMut.mutateAsync({
        email: player.guardianEmail!,
        password: defaultPassword,
        name: player.guardianName || 'Guardian',
        role: 'guardian',
      });
      await linkGuardianMut.mutateAsync({
        guardianId: newMember.userId!,
        tryoutId: id!,
        playerId: player.athleteId!,
      });
      await alert(
        'Guardian Re-created',
        `An account was created for ${player.guardianEmail} and an email was sent containing their temporary password:\n\n${defaultPassword}`,
      );
    } catch (createErr) {
      await alert(
        'Invite Failed',
        createErr instanceof Error ? createErr.message : 'Could not re-create guardian account.',
      );
    }
  };

  const resendInvite = async () => {
    try {
      await resendInviteMut.mutateAsync({
        userId: player.linkedGuardianId!,
        email: player.guardianEmail!,
        role: 'guardian',
      });
      await alert('Invite Sent', `Resent the invite to ${player.guardianEmail}. A temporary password is only included if their account has never been used.`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (
        msg.includes('User not found') ||
        msg.includes('not found') ||
        msg.includes('Database error') ||
        msg.includes('finding user')
      ) {
        const ok = await confirm({
          title: 'Invite Failed',
          message: 'This login account no longer exists. Would you like to unlink it and send a new invite?',
          confirmLabel: 'Re-invite',
        });
        if (ok) await recreateGuardian();
      } else {
        await alert('Invite Failed', msg || 'Could not resend invite.');
      }
    }
  };

  const submitFamilyContact = async () => {
    if (!contactName.trim()) {
      await alert('Missing Info', 'Enter at least a name.');
      return;
    }
    try {
      await addFamilyContactMut.mutateAsync({
        name: contactName.trim(),
        relationship: contactRelationship.trim() || undefined,
        email: contactEmail.trim() || undefined,
        phone: contactPhone.trim() || undefined,
      });
      setContactName('');
      setContactRelationship('');
      setContactEmail('');
      setContactPhone('');
      setShowAddContact(false);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not add this contact.');
    }
  };

  const confirmRemoveContact = async (contactId: string, name: string) => {
    const ok = await confirm({
      title: 'Remove Contact',
      message: `Remove ${name} from this athlete's family contacts?`,
      confirmLabel: 'Remove',
      destructive: true,
      requireText: 'DELETE',
    });
    if (!ok) return;
    try {
      await removeFamilyContactMut.mutateAsync(contactId);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not remove this contact.');
    }
  };

  const confirmUnlinkGuardian = async () => {
    const ok = await confirm({
      title: 'Remove Guardian',
      message: `Unlink ${player.guardianName || player.guardianEmail || 'this guardian'}'s account from ${playerDisplayName(player)}? They will no longer be able to view this athlete.`,
      confirmLabel: 'Remove',
      destructive: true,
      requireText: 'DELETE',
    });
    if (!ok) return;
    try {
      await unlinkGuardianMut.mutateAsync({ tryoutId: id!, playerId: player.athleteId! });
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Could not remove this guardian.');
    }
  };

  const linkGuardian = async () => {
    const email = player.guardianEmail!;
    try {
      const member = await inviteMut.mutateAsync({ email, role: 'guardian' });
      await linkGuardianMut.mutateAsync({
        guardianId: member.userId!,
        tryoutId: id!,
        playerId: player.athleteId!,
      });
      setShowGuardianLink(false);
      await alert('Success', 'Guardian account linked and invitation sent successfully.');
    } catch (error) {
      if (error instanceof Error && error.message?.includes('User not found')) {
        try {
          const defaultPassword = Math.random().toString(36).slice(-6) + 'Aa1!';
          const newMember = await createAndInviteMut.mutateAsync({
            email,
            password: defaultPassword,
            name: player.guardianName || 'Guardian',
            role: 'guardian',
          });
          await linkGuardianMut.mutateAsync({
            guardianId: newMember.userId!,
            tryoutId: id!,
            playerId: player.athleteId!,
          });
          setShowGuardianLink(false);
          await alert(
            'Guardian Created',
            `An account was created for ${email} and an email was sent to them containing their temporary password:\n\n${defaultPassword}`,
          );
        } catch (createErr) {
          await alert(
            'Invite Failed',
            createErr instanceof Error ? createErr.message : 'Could not auto-create guardian account.',
          );
        }
      } else {
        await alert('Invite Failed', error instanceof Error ? error.message : 'Could not link guardian.');
      }
    }
  };

  // Invites a family contact to the guardian portal and connects them to this
  // athlete — see useInviteFamilyContact for how the athlete's single guardian
  // slot and additional guardians are handled.
  const inviteFamilyContact = async (contact: { id: string; name: string; email?: string }) => {
    if (!contact.email?.trim() || !player.athleteId) return;
    setInvitingContactId(contact.id);
    try {
      const result = await inviteContact(contact, {
        athleteId: player.athleteId,
        linkedGuardianId: player.linkedGuardianId,
        guardianEmail: player.guardianEmail,
        tryoutId: id,
      });
      if (result) await alert('Invite Sent', describeInvite(result, contact.name, playerDisplayName(player)));
    } catch (e) {
      await alert('Invite Failed', e instanceof Error ? e.message : 'Could not invite this contact.');
    } finally {
      setInvitingContactId(null);
    }
  };

  const aiNotice = aiError ? (
    <div className="mt-3 rounded-xl p-3" style={{ backgroundColor: colors.tile }}>
      <p className="font-bold" style={{ color: colors.ink }}>
        Notice
      </p>
      <p className="mt-1" style={{ color: colors.inkMuted }}>
        {aiError.toLowerCase().includes('key') || aiError.toLowerCase().includes('developed')
          ? 'This feature relies on an API key that is currently missing or in development. It will be built out soon.'
          : aiError}
      </p>
      <Button
        label="Retry"
        size="sm"
        variant="secondary"
        className="mt-2"
        onClick={() => {
          setAiError(null);
          aiSummary.mutate(playerId);
        }}
      />
    </div>
  ) : null;

  return (
    <>
      {/* The page above only offers "All evaluations", so say outright where
          this goes: back to the evaluation the player is on. It is the only back
          control here, so it is sized to be found. */}
      <button
        type="button"
        onClick={() => router.push(href('roster'))}
        className="mb-3 inline-flex items-center gap-2 py-1 text-base font-bold"
        style={{ color: colors.ink }}
      >
        <svg width={22} height={22} viewBox="0 0 24 24" fill="none">
          <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" />
        </svg>
        Back to {tryout.name}
      </button>
      <PageHeader
        title={playerDisplayName(player)}
        subtitle={`#${player.jersey ?? '—'} · ${player.pos ?? '—'}`}
        right={
          <>
            <Button label={terms.t('Score Player')} onClick={() => router.push(href(`score/${playerId}`))} />
            {/* Edit is open to anyone who can assess — including an invited
                assessor — since fixing a wrong jersey number or position
                shouldn't need the owning coach; Delete stays coach/admin-only. */}
            {canAssess ? <Button label="Edit" variant="secondary" onClick={() => setShowEdit(true)} /> : null}
          </>
        }
      />

      <div className="grid grid-cols-1 min-w-0 gap-5 lg:grid-cols-[280px_1fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card className="flex flex-col items-center gap-2 py-6">
            <Avatar first={player.first} last={player.last} pos={player.pos} size={88} uri={player.avatarUrl} />
            <span className="text-lg font-bold" style={{ color: colors.ink }}>
              {playerDisplayName(player)}
            </span>
            <span className="text-sm" style={{ color: colors.inkMuted }}>
              #{player.jersey ?? '—'} · {player.pos ?? '—'}
            </span>
            {player.registrationSource === 'qr' ? <Badge label="QR Registered" variant="info" /> : null}
            {player.yearOfBirth ? <Badge label={`Born ${formatBirth(player.dateOfBirth, player.yearOfBirth)}`} /> : null}
            {player.playerEmail ? (
              <span className="break-words text-sm" style={{ color: colors.inkMuted }}>{player.playerEmail}</span>
            ) : null}
          </Card>

          <Card className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <SectionLabel>Guardian Access</SectionLabel>
              {player.linkedGuardianId ? <Badge label="Linked" variant="success" /> : null}
            </div>

            {player.guardianName ? (
              <span className="break-words" style={{ color: colors.ink }}>{player.guardianName}</span>
            ) : null}
            {player.guardianEmail ? (
              <span className="break-words" style={{ color: colors.inkMuted }}>{player.guardianEmail}</span>
            ) : null}
            {!player.guardianName && !player.guardianEmail ? (
              <span style={{ color: colors.inkFaint }}>No guardian info provided.</span>
            ) : null}

            {isCoachHere ? (
              player.linkedGuardianId && player.guardianEmail ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    label="Resend Invite"
                    variant="secondary"
                    size="sm"
                    onClick={resendInvite}
                    loading={resendInviteMut.isPending}
                  />
                  <Button
                    label="Remove"
                    variant="ghost"
                    size="sm"
                    onClick={confirmUnlinkGuardian}
                    loading={unlinkGuardianMut.isPending}
                  />
                </div>
              ) : !player.linkedGuardianId ? (
                <Button
                  label="Link Account"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowGuardianLink(true)}
                />
              ) : null
            ) : null}
          </Card>

          {/* Open to anyone who can assess — including an invited assessor,
              same as Edit above — so they can see and correct the same family
              contacts a coach can. */}
          {player.athleteId && canAssess ? (
            <Card className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <SectionLabel>Family Contacts</SectionLabel>
                <Button label="+ Add" size="sm" variant="ghost" onClick={() => setShowAddContact(true)} />
              </div>
              <p className="text-xs" style={{ color: colors.inkMuted }}>
                {terms.t('A second parent, a grandparent, or anyone else who should get invites for this player.')}
              </p>
              {familyContactsQuery.isLoading ? (
                <Spinner size={16} />
              ) : (familyContactsQuery.data ?? []).length === 0 ? (
                <span style={{ color: colors.inkFaint }}>No additional contacts added yet.</span>
              ) : (
                <div className="flex flex-col gap-2">
                  {(familyContactsQuery.data ?? []).map((c) => (
                    <div key={c.id} className="flex items-center justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0" style={{ borderColor: colors.border }}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium" style={{ color: colors.ink }}>
                          {c.name}
                          {c.relationship ? ` · ${c.relationship}` : ''}
                        </p>
                        {c.email ? <p className="truncate text-xs" style={{ color: colors.inkMuted }}>{c.email}</p> : null}
                        {c.phone ? <p className="truncate text-xs" style={{ color: colors.inkMuted }}>{c.phone}</p> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {c.email && isCoachHere ? (
                          <Button
                            label="Invite"
                            variant="secondary"
                            size="sm"
                            onClick={() => inviteFamilyContact(c)}
                            loading={invitingContactId === c.id}
                          />
                        ) : null}
                        <Button
                          label="Remove"
                          variant="ghost"
                          size="sm"
                          onClick={() => confirmRemoveContact(c.id, c.name)}
                          loading={removeFamilyContactMut.isPending && removeFamilyContactMut.variables === c.id}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : null}

          {/* Coach only, matching the Letters tool itself — an invited
              assessor scores and edits the roster but doesn't decide who made
              the team. */}
          {isCoachHere ? (
            <Card className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <SectionLabel>Letters</SectionLabel>
                <Button label="Send a Letter" size="sm" variant="ghost" onClick={() => setShowLetter(true)} />
              </div>
              {playerLettersQuery.isLoading ? (
                <Spinner size={16} />
              ) : playerLetters.length === 0 ? (
                <span style={{ color: colors.inkFaint }}>
                  {terms.t('No offer or roster decision letters sent to this player yet.')}
                </span>
              ) : (
                <div className="flex flex-col gap-2">
                  {playerLetters.map((l) => (
                    <div
                      key={l.id}
                      className="flex items-start justify-between gap-2 border-b pb-2 last:border-b-0 last:pb-0"
                      style={{ borderColor: colors.border }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="truncate font-medium" style={{ color: colors.ink }}>
                            {l.subject}
                          </p>
                          <Badge
                            label={l.status}
                            variant={l.status === 'sent' ? 'success' : l.status === 'failed' ? 'danger' : 'warning'}
                          />
                        </div>
                        <p className="truncate text-xs" style={{ color: colors.inkMuted }}>
                          {LETTER_KIND_LABELS[l.kind]}
                          {l.recipientEmail ? ` · ${l.recipientEmail}` : ''}
                          {l.sentAt ? ` · ${new Date(l.sentAt).toLocaleDateString()}` : ''}
                        </p>
                        {l.status === 'failed' && l.error ? (
                          <p className="mt-0.5 text-xs" style={{ color: colors.danger }}>
                            {l.error}
                          </p>
                        ) : null}
                      </div>
                      <Button
                        label={l.status === 'sent' ? 'Re-send' : 'Retry'}
                        variant="ghost"
                        size="sm"
                        loading={resendLetterMut.isPending && resendLetterMut.variables === l.id}
                        onClick={async () => {
                          try {
                            const updated = await resendLetterMut.mutateAsync(l.id);
                            if (updated.status === 'failed') {
                              await alert('Not Sent', updated.error || 'The letter could not be sent.');
                            }
                          } catch (e) {
                            await alert('Send Failed', e instanceof Error ? e.message : 'Could not re-send.');
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : null}

          {isCoachHere ? (
            <Card className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <SectionLabel>Report Card</SectionLabel>
                <Button
                  label="Create Report Card"
                  size="sm"
                  variant="ghost"
                  onClick={() => router.push(href(`player/${playerId}/report-card`))}
                />
              </div>
              <span style={{ color: colors.inkFaint }}>
                {(reportCardsQuery.data?.length ?? 0) === 0
                  ? 'Pick evaluations, add your comments (and AI comments), attach video or files, and print or share it when you sit down with the family.'
                  : `${reportCardsQuery.data!.length} saved report card${reportCardsQuery.data!.length === 1 ? '' : 's'}. Open the builder to view, edit or print them.`}
              </span>
            </Card>
          ) : null}

          {isCoachHere ? (
            <Button
              label={terms.t('Delete Player')}
              variant="danger"
              loading={deletePlayer.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: terms.t('Delete Player'),
                  message: terms.t('Are you sure you want to delete this player? This cannot be undone.'),
                  confirmLabel: 'Delete',
                  destructive: true,
                  requireText: 'DELETE',
                });
                if (!ok) return;
                await deletePlayer.mutateAsync(playerId);
                router.push(href('roster'));
              }}
            />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Card accent className="flex flex-col gap-2">
            <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
              Development Summary
            </span>
            <span style={{ color: colors.inkMuted }}>{heuristic.summary}</span>
            <span className="text-sm" style={{ color: colors.primary }}>
              Role fit: {heuristic.role_fit}
            </span>

            <PlanGate feature="aiSummaries" title="Deep AI Insights (Club+)">
              {deepDive ? (
                <div className="mt-2 border-t pt-3" style={{ borderColor: colors.border }}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-bold" style={{ color: colors.primary }}>
                      AI Advanced Analysis
                    </span>
                    <Button
                      label={aiSummary.isPending ? 'Processing...' : '↻ Regenerate'}
                      size="sm"
                      variant="ghost"
                      onClick={runAi}
                      loading={aiSummary.isPending}
                    />
                  </div>
                  {aiSummary.isPending ? (
                    <div className="flex flex-col items-center gap-2 p-4">
                      <Spinner size={28} />
                      <span style={{ color: colors.ink }}>{aiLoadingText}</span>
                    </div>
                  ) : (
                    <>
                      <p style={{ color: colors.ink }}>{deepDive.summary}</p>
                      {deepDive.key_strengths?.map((s: string) => (
                        <p key={s} className="mt-1 text-sm" style={{ color: colors.success }}>
                          + {s}
                        </p>
                      ))}
                      {deepDive.key_growth?.map((s: string) => (
                        <p key={s} className="mt-1 text-sm" style={{ color: colors.primary }}>
                          - {s}
                        </p>
                      ))}
                    </>
                  )}
                  {aiNotice}
                </div>
              ) : (
                <div className="mt-2">
                  {aiSummary.isPending ? (
                    <div className="flex flex-col items-center gap-2 p-4">
                      <Spinner size={28} />
                      <span style={{ color: colors.ink }}>{aiLoadingText}</span>
                    </div>
                  ) : (
                    <Button label="Generate AI Deep Dive" size="sm" onClick={runAi} loading={aiSummary.isPending} />
                  )}
                  {aiNotice}
                </div>
              )}
            </PlanGate>
          </Card>

          {/* The whole profile, inline: details, season-over-season and the
              evaluation history. It is history an assessor scores without —
              they only ever see the assessment in front of them. */}
          {isAssessorOnly || !player.athleteId ? null : (
            <PlayerProfileSection
              athleteId={player.athleteId}
              onEditDetails={canAssess ? () => setShowEdit(true) : undefined}
            />
          )}

          {/* Every evaluator's scores, recommendation and notes, with an Edit
              button on each — the same content the coach-only Results tab
              exists to gate, and exactly what get_session_progress_for_tryout()
              (see its migration) was built to give assessors numbering hints
              *without* exposing, so a blind assessment can't be biased by
              reading someone else's take first. */}
          {isAssessorOnly ? null : (
          <div>
            <SectionLabel className="mb-3">Evaluations ({evals.length})</SectionLabel>
            {evals.length === 0 ? (
              <EmptyState title="No evaluations yet" message={terms.t('Use Score Player to add the first evaluation.')} />
            ) : (
              <div className="flex flex-col gap-2">
                {evals.map((ev) => {
                  const overall = weightedOverall(ev.scores ?? {}, categories, weights);
                  return (
                    <Card key={ev.id} className="flex flex-col gap-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold" style={{ color: colors.ink }}>
                          {ev.session} · {ev.date} {overall > 0 ? `· Score: ${overall.toFixed(1)}` : ''}
                        </span>
                        {ev.recommendation ? <Badge label={ev.recommendation} variant="brand" /> : null}
                      </div>
                      <span className="text-sm" style={{ color: colors.inkMuted }}>
                        {ev.evaluator}
                      </span>
                      {ev.strengths ? (
                        <span className="mt-1 text-sm" style={{ color: colors.ink }}>
                          + {ev.strengths}
                        </span>
                      ) : null}
                      {ev.improve ? (
                        <span className="text-sm" style={{ color: colors.inkMuted }}>
                          → {ev.improve}
                        </span>
                      ) : null}
                      <div>
                        <Button
                          label="Edit Score"
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const base = href(`score/${playerId}`);
                            router.push(`${base}${base.includes('?') ? '&' : '?'}evalId=${ev.id}`);
                          }}
                        />
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
          )}
        </div>
      </div>

      {isCoachHere ? (
        <PlayerLetterModal
          tryout={tryout}
          player={player}
          visible={showLetter}
          onClose={() => setShowLetter(false)}
          onOpenTool={() => router.push(href('letters'))}
        />
      ) : null}

      <Modal visible={showEdit} title={terms.t('Edit Player')} size="lg" onClose={() => setShowEdit(false)} hideDefaultFooter>
        <AddPlayerForm
          defaultValues={player}
          sport={tryout.sport}
          labels={tryout.settings.customLabels}
          loading={updatePlayer.isPending || uploadPhoto.isPending}
          showFamilyContacts={canAssess}
          onSubmit={async (data, _inviteEmails, extraFamilyContacts) => {
            try {
              if (player.athleteId && data.avatarUrl?.startsWith('blob:')) {
                try {
                  data.avatarUrl = await uploadPhoto.mutateAsync({
                    athleteId: player.athleteId,
                    fileUri: data.avatarUrl,
                    fileType: 'image/jpeg',
                  });
                } catch (e) {
                  await alert(
                    'Upload Error',
                    `Failed to upload profile picture: ${e instanceof Error ? e.message : 'Unknown error'}`,
                  );
                }
              }
              await updatePlayer.mutateAsync({ playerId, updates: data });
              // Previously dropped silently: this callback only ever read
              // `data`, so a family member added from inside Edit Player was
              // typed in, appeared to save, and never reached the database —
              // which is why it showed up nowhere, for anyone.
              const contacts = (extraFamilyContacts ?? []).filter((c: ExtraFamilyContact) => c.name.trim() || c.email.trim());
              if (player.athleteId && contacts.length > 0) {
                try {
                  await Promise.all(
                    contacts.map((c: ExtraFamilyContact) =>
                      addFamilyContactMut.mutateAsync({ name: c.name || c.email, email: c.email || undefined }),
                    ),
                  );
                } catch (e) {
                  await alert(
                    'Family Members Not Saved',
                    `The player was saved, but the additional family members couldn't be added: ${e instanceof Error ? e.message : 'Unknown error'}`,
                  );
                }
              }
              setShowEdit(false);
            } catch (err) {
              await alert('Save Error', `Failed to update player: ${err instanceof Error ? err.message : ''}`);
            }
          }}
        />
      </Modal>

      <Modal
        visible={showAddContact}
        title="Add Family Member"
        onClose={() => {
          if (addFamilyContactMut.isPending) return;
          setShowAddContact(false);
        }}
        hideDefaultFooter
      >
        <div className="flex flex-col gap-3">
          <Input label="Name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
          <Input
            label="Relationship"
            value={contactRelationship}
            onChange={(e) => setContactRelationship(e.target.value)}
            placeholder="e.g. Grandmother, Emergency Contact"
          />
          <Input
            label="Email"
            type="email"
            autoCapitalize="none"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
          <Input label="Phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          <Button
            label="Add Contact"
            onClick={submitFamilyContact}
            loading={addFamilyContactMut.isPending}
            disabled={!contactName.trim()}
          />
        </div>
      </Modal>

      <Modal visible={showGuardianLink} title="Link Guardian" onClose={() => setShowGuardianLink(false)}>
        <div className="flex flex-col gap-3">
          <p style={{ color: colors.ink }}>
            Link {player.first} to a guardian account to grant them portal access.
          </p>
          {player.guardianEmail ? (
            <>
              {player.linkedGuardianId ? (
                <p className="text-sm" style={{ color: colors.inkMuted }}>
                  This guardian is already linked. Sending a new invite will refresh their access.
                </p>
              ) : null}
              <Button
                label={`Invite ${player.guardianEmail}`}
                onClick={linkGuardian}
                loading={inviteMut.isPending || linkGuardianMut.isPending || createAndInviteMut.isPending}
              />
            </>
          ) : (
            <p style={{ color: colors.inkMuted }}>
              No email on file. Edit the player profile to add a guardian email first.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
