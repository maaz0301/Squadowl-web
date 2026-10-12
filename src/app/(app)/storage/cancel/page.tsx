'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button, Card, ErrorState, Input, LoadingState, PageHeader, useAlert } from '@/components/ui';
import { useAccountVideosQuery, useManageVideoStorageMutation, useVideoStorageQuery } from '@/features/queries';
import { getDataSource } from '@/data';
import { formatBytes } from '@/data/videoStorage';
import { useThemeColors } from '@/theme/ThemeProvider';

const RED = '#ef4444';

const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

export default function CancelVideoStoragePage() {
  return (
    <Suspense fallback={<LoadingState message="Loading your videos..." />}>
      <CancelContent />
    </Suspense>
  );
}

/**
 * The two-screen warning shown before anything that deletes videos.
 *
 *   Screen 1  a full-page warning listing every video and the total stored, with
 *             Go Back as the prominent button and Continue kept quiet.
 *   Screen 2  the coach must type DELETE exactly before the button turns on.
 *
 * `?reason=addon` cancels the storage add-on; `?reason=plan` is the step before
 * cancelling or dropping the plan below Coach+, which also ends storage, and it
 * finishes by opening the Stripe billing portal. Nothing is deleted here: Stripe
 * keeps the storage until the paid period ends, and the maintenance function
 * deletes the files then, after two reminder emails.
 */
function CancelContent() {
  const colors = useThemeColors();
  const router = useRouter();
  const search = useSearchParams();
  const { alert } = useAlert();
  const reason: 'addon' | 'plan' = search.get('reason') === 'plan' ? 'plan' : 'addon';

  const storage = useVideoStorageQuery();
  const videosQuery = useAccountVideosQuery();
  const manage = useManageVideoStorageMutation();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const [endsAt, setEndsAt] = useState<number | null>(null);

  const info = storage.data;
  const videos = videosQuery.data ?? [];

  if (storage.isLoading || videosQuery.isLoading) return <LoadingState message="Loading your videos..." />;
  if (storage.isError || !info) {
    return (
      <>
        <PageHeader title="Cancel" showBack />
        <ErrorState message="Could not load your video storage." onRetry={() => storage.refetch()} />
      </>
    );
  }

  const deletionDate = info.deletionAt ?? info.cancelAt;

  const openPortal = async () => {
    const res = await getDataSource().createPortalSession();
    if (res?.url) window.location.href = res.url;
  };

  const confirm = async () => {
    setWorking(true);
    try {
      if (reason === 'addon') {
        const res = await manage.mutateAsync({ action: 'cancel', confirm: 'DELETE' });
        setEndsAt(res.cancelAt ? new Date(res.cancelAt).getTime() : null);
        setStep(3);
      } else {
        await getDataSource().acknowledgeVideoDeletion(info.accountId);
        await openPortal();
      }
    } catch (e) {
      await alert('Could not continue', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setWorking(false);
    }
  };

  if (step === 3) {
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4 py-10">
        <h1 className="text-2xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          Your videos stay until {endsAt ? dateLabel(endsAt) : 'the end of your billing period'}
        </h1>
        <p className="text-base" style={{ color: colors.inkMuted }}>
          Everything remains available until then. We will email you 7 days and 1 day before, and again when the videos are
          permanently deleted. You can keep your storage any time before that from the Library.
        </p>
        <div>
          <Button label="Done" onClick={() => router.push('/library')} />
        </div>
      </div>
    );
  }

  if (step === 2) {
    const ready = typed === 'DELETE';
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-4">
        <PageHeader title="Confirm" showBack onBack={() => setStep(1)} />
        <h1 className="text-2xl font-bold" style={{ color: RED, fontFamily: 'var(--font-space-grotesk)' }}>
          This permanently deletes {videos.length} video{videos.length === 1 ? '' : 's'}
        </h1>
        <p className="text-base" style={{ color: colors.inkMuted }}>
          Once deleted, {formatBytes(info.usedBytes)} of video cannot be recovered. To continue, type DELETE below exactly as
          shown, in capital letters.
        </p>
        <Input label="Type DELETE" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" placeholder="DELETE" />
        <Button
          label={reason === 'addon' ? 'Cancel storage and delete videos' : 'Continue to billing'}
          variant="danger"
          disabled={!ready || working}
          loading={working}
          onClick={confirm}
        />
        <Button label="Go back" variant="secondary" onClick={() => router.push('/library')} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4">
      <PageHeader title={reason === 'addon' ? 'Cancel video storage' : 'Before you continue'} showBack />
      <h1 className="text-2xl font-bold" style={{ color: RED, fontFamily: 'var(--font-space-grotesk)' }}>
        Everything will be deleted
      </h1>
      <p className="text-base" style={{ color: colors.ink }}>
        {reason === 'addon'
          ? 'Cancelling video storage deletes every video stored for this account.'
          : 'Cancelling your plan, or moving below Coach+, ends video storage and deletes every video stored for this account.'}{' '}
        {deletionDate ? `They stay available until ${dateLabel(deletionDate)}` : 'They stay available until the end of your billing period'}
        , then they are permanently removed.
      </p>

      <Card className="flex flex-col gap-2">
        <p className="text-sm font-bold" style={{ color: colors.ink }}>
          {videos.length} video{videos.length === 1 ? '' : 's'} · {formatBytes(info.usedBytes)} used
        </p>
        <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {videos.map((v) => (
            <li key={v.id} className="flex justify-between gap-3 text-sm" style={{ color: colors.inkMuted }}>
              <span className="truncate">{v.title || v.fileName}</span>
              <span className="shrink-0">{formatBytes(v.sizeBytes)}</span>
            </li>
          ))}
        </ul>
      </Card>

      {/* Go Back is the loud button; Continue is deliberately small and quiet. */}
      <Button label="Go back" size="lg" onClick={() => router.push('/library')} />
      <div className="flex flex-col items-start gap-1">
        <Button label="Continue" size="sm" variant="ghost" onClick={() => setStep(2)} />
        {reason === 'plan' ? (
          <Button
            label="I only need to view or update billing details"
            size="sm"
            variant="ghost"
            onClick={() => openPortal().catch((e) => alert('Portal Error', e instanceof Error ? e.message : 'Try again.'))}
          />
        ) : null}
      </div>
    </div>
  );
}
