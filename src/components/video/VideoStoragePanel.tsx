'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';

import { Badge, Button, Card, Input, Switch, useAlert } from '@/components/ui';
import { StorageMeterBar } from '@/components/video/StorageMeter';
import {
  useAccountVideosQuery,
  useDeleteAccountVideoMutation,
  useInvalidateVideoStorage,
  useManageVideoStorageMutation,
  useSetVideoPermissionsMutation,
  useVideoStorageQuery,
} from '@/features/queries';
import { getDataSource } from '@/data';
import {
  VIDEO_STORAGE_PLANS,
  formatBytes,
  formatPlanPrice,
  type AccountVideo,
  type VideoContext,
  type VideoStorageGb,
  discountedPriceCents,
  formatCents,
  type StorageDiscount,
} from '@/data/videoStorage';
import { useThemeColors } from '@/theme/ThemeProvider';

const CONTEXT_LABEL: Record<VideoContext, string> = {
  library: 'Library',
  report_card: 'Report card',
  evaluation: 'Evaluation',
  team_post: 'Team feed',
};

const dateLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * Video storage inside the Library: the meter, the plans and their prices, who
 * may upload and download, and every stored video with its size and a Delete.
 */
export function VideoStoragePanel() {
  return (
    <Suspense fallback={null}>
      <StorageContent />
    </Suspense>
  );
}

function StorageContent() {
  const colors = useThemeColors();
  const router = useRouter();
  const search = useSearchParams();
  const { alert, confirm, toast } = useAlert();
  const storage = useVideoStorageQuery();
  const info = storage.data;
  const videosQuery = useAccountVideosQuery(undefined, { enabled: !!info?.canManage });
  const deleteVideo = useDeleteAccountVideoMutation();
  const setPerms = useSetVideoPermissionsMutation();
  const manage = useManageVideoStorageMutation();
  const invalidate = useInvalidateVideoStorage();
  const videos = useMemo(() => videosQuery.data ?? [], [videosQuery.data]);

  // Coming back from Stripe: the webhook may land a moment after the redirect.
  const justPaid = search.get('success') === 'true';
  useEffect(() => {
    if (!justPaid) return;
    invalidate();
    const t = setTimeout(invalidate, 4000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justPaid]);

  // A founder-issued discount code for the add-on. Checked here for the price shown; checkout checks it again.
  const [codeInput, setCodeInput] = useState('');
  const [applied, setApplied] = useState<(StorageDiscount & { code: string; duration: string }) | null>(null);
  const [checkingCode, setCheckingCode] = useState(false);
  const applyCode = async () => {
    const value = codeInput.trim();
    if (!value) return;
    setCheckingCode(true);
    try {
      const r = await getDataSource().previewDiscountCode(value, 'video_storage');
      if (!r.valid) {
        await alert('Discount code', r.message);
        return;
      }
      setApplied({ code: r.code, kind: r.kind, percentOff: r.percentOff, amountOffCents: r.amountOffCents, duration: r.duration });
      setCodeInput('');
    } catch (e) {
      await alert('Discount code', e instanceof Error ? e.message : 'That code could not be checked.');
    } finally {
      setCheckingCode(false);
    }
  };

  const buy = useMutation({
    mutationFn: async (gb: VideoStorageGb) => {
      const res = await getDataSource().createVideoStorageCheckoutSession(gb, { discountCode: applied?.code });
      if (res?.url) window.location.href = res.url;
    },
    onError: (e) => alert('Could not start the purchase', e instanceof Error ? e.message : 'Try again.'),
  });

  // Staff and managers only; players and guardians never see account storage.
  if (!info || (!info.canManage && !info.canUpload)) return null;

  const confirmDelete = async (video: AccountVideo) => {
    const ok = await confirm({
      title: 'Delete video',
      message: `Delete "${video.title || video.fileName}"? This frees ${formatBytes(video.sizeBytes)}.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    deleteVideo.mutate(video.id, { onError: (e) => alert('Could not delete', e instanceof Error ? e.message : 'Try again.') });
  };

  const changeSize = async (gb: VideoStorageGb) => {
    const plan = VIDEO_STORAGE_PLANS.find((p) => p.gb === gb)!;
    const ok = await confirm({
      title: `Switch to ${plan.label}?`,
      message:
        gb > info.gb
          ? `You will confirm the price and pay the difference for the rest of your year on the next page. After that it is ${formatPlanPrice(plan)}.`
          : `${plan.label} is ${formatPlanPrice(plan)} from your next renewal. There is no refund for the current year.`,
      confirmLabel: gb > info.gb ? 'Continue to payment' : 'Switch',
    });
    if (!ok) return;
    manage.mutate(
      { action: 'change', storageGb: gb },
      {
        onSuccess: (res) => {
          // A larger size is paid for on Stripe's page; the size changes once it confirms.
          if (res?.url) {
            window.location.href = res.url;
            return;
          }
          toast(`Switched to ${plan.label}`, 'success');
        },
        onError: (e) => alert('Could not change the size', e instanceof Error ? e.message : 'Try again.'),
      },
    );
  };

  const resume = () =>
    manage.mutate(
      { action: 'resume' },
      {
        onSuccess: () => toast('Your storage will renew', 'success'),
        onError: (e) => alert('Could not resume', e instanceof Error ? e.message : 'Try again.'),
      },
    );

  const goCancel = () => {
    if (info.source === 'apple' || info.source === 'google') {
      window.open(
        info.source === 'apple' ? 'https://apps.apple.com/account/subscriptions' : 'https://play.google.com/store/account/subscriptions',
        '_blank',
        'noopener,noreferrer',
      );
      return;
    }
    router.push('/storage/cancel?reason=addon');
  };

  const ending = info.entitled && info.cancelAt != null;

  return (
    <div className="mb-4 flex flex-col gap-4">
      {justPaid ? (
        <Card>
          <p className="text-sm font-bold" style={{ color: colors.ink }}>
            Thank you. {info.entitled ? 'Your video storage is active.' : 'Your video storage will switch on in a moment.'}
          </p>
        </Card>
      ) : null}

      {!info.planEligible ? (
        <Card className="flex flex-col gap-2">
          <p className="text-base font-bold" style={{ color: colors.ink }}>
            Video storage needs a paid plan
          </p>
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            Upload compressed videos to the Library, report cards, evaluations and the team feed. It is sold as a yearly
            add-on for Coach, Coach+ and Club plans.
          </p>
          <div>
            <Link href="/upgrade" className="inline-block rounded-lg px-4 py-2 text-sm font-semibold" style={{ background: colors.primary, color: '#fff' }}>
              See plans
            </Link>
          </div>
        </Card>
      ) : null}

      {info.planEligible && !info.entitled && info.canManage ? (
        <Card className="flex flex-col gap-3">
          <p className="text-base font-bold" style={{ color: colors.ink }}>
            Add video storage
          </p>
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            One yearly add-on, shared by every team on your account. Videos are compressed to 720p before they upload, and are
            never deleted because of age.
          </p>
          {applied ? (
            <div className="flex items-center justify-between gap-2 rounded-xl border p-3" style={{ borderColor: colors.primary }}>
              <p className="text-sm font-bold" style={{ color: colors.ink }}>
                Code {applied.code} applied:{' '}
                {applied.kind === 'percent' ? `${applied.percentOff}% off` : `${formatCents(applied.amountOffCents ?? 0)} off`}
                {applied.duration === 'once' ? ' your first year' : applied.duration === 'forever' ? ' every year' : ''}
              </p>
              <Button size="sm" variant="ghost" label="Remove" onClick={() => setApplied(null)} />
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Input
                  label="Discount code"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                  placeholder="Enter a code"
                  autoComplete="off"
                />
              </div>
              <Button size="sm" variant="secondary" label="Apply" loading={checkingCode} disabled={!codeInput.trim()} onClick={applyCode} />
            </div>
          )}
          {VIDEO_STORAGE_PLANS.map((plan) => (
            <div key={plan.gb} className="flex items-center justify-between rounded-xl border p-3" style={{ borderColor: colors.border }}>
              <div>
                <p className="text-base font-bold" style={{ color: colors.ink }}>
                  {plan.name} · {plan.label}
                </p>
                <p className="text-sm" style={{ color: colors.inkMuted }}>
                  {applied ? (
                    <>
                      <span style={{ textDecoration: 'line-through' }}>{formatPlanPrice(plan)}</span>{' '}
                      <span className="font-bold" style={{ color: colors.primary }}>
                        {formatCents(discountedPriceCents(plan.priceCents, applied))}
                      </span>
                    </>
                  ) : (
                    formatPlanPrice(plan)
                  )}
                </p>
              </div>
              <Button
                size="sm"
                label="Choose"
                loading={buy.isPending && buy.variables === plan.gb}
                disabled={buy.isPending}
                onClick={() => buy.mutate(plan.gb)}
              />
            </div>
          ))}
        </Card>
      ) : null}

      {!info.entitled && info.videoCount > 0 ? (
        <Card className="flex flex-col gap-1" style={{ borderColor: '#ef4444' }}>
          <p className="text-base font-bold" style={{ color: '#ef4444' }}>
            Your videos are scheduled for deletion
          </p>
          <p className="text-sm" style={{ color: colors.inkMuted }}>
            {info.deletionAt
              ? `${info.videoCount} video${info.videoCount === 1 ? '' : 's'} will be permanently deleted on ${dateLabel(info.deletionAt)}.`
              : `${info.videoCount} video${info.videoCount === 1 ? '' : 's'} will be permanently deleted.`}{' '}
            Add video storage again to keep them.
          </p>
        </Card>
      ) : null}

      {info.entitled ? (
        <>
          <Card className="flex flex-col gap-3">
            <StorageMeterBar info={info} />
            <div className="flex flex-wrap items-center gap-2">
              <Badge label={`${VIDEO_STORAGE_PLANS.find((p) => p.gb === info.gb)?.name ?? ''} ${info.gb} GB`.trim()} variant="info" />
              <span className="text-xs" style={{ color: colors.inkMuted }}>
                {info.videoCount} video{info.videoCount === 1 ? '' : 's'}
              </span>
            </div>
            {ending ? (
              <div className="flex flex-col gap-2 rounded-xl border p-3" style={{ borderColor: '#ef4444' }}>
                <p className="text-sm font-bold" style={{ color: '#ef4444' }}>
                  Cancelled. Videos delete on {dateLabel(info.cancelAt!)}.
                </p>
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  They stay available until then. We will email you 7 days and 1 day before.
                </p>
                {info.canManage && info.source === 'stripe' ? (
                  <div>
                    <Button variant="secondary" label="Keep my storage" onClick={resume} loading={manage.isPending} />
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>

          {info.canManage ? (
            <Card className="flex flex-col gap-3">
              <p className="text-base font-bold" style={{ color: colors.ink }}>
                Who can upload and view
              </p>
              <p className="text-xs" style={{ color: colors.inkMuted }}>
                The coach can always upload. Players and guardians can watch videos but not download them unless you allow it.
              </p>
              <Switch
                label="Managers and assessors can upload"
                checked={info.managersCanUpload}
                onChange={(v) => setPerms.mutate({ accountId: info.accountId, managersCanUpload: v })}
              />
              <Switch
                label="Players and guardians can download"
                checked={info.viewersCanDownload}
                onChange={(v) => setPerms.mutate({ accountId: info.accountId, viewersCanDownload: v })}
              />
              <p className="text-xs" style={{ color: colors.inkMuted }}>
                Who sees each Library video is set on the item itself with the Library audience toggles. Videos managers and
                assessors upload count against this account&apos;s storage.
              </p>
            </Card>
          ) : null}

          {info.canManage && info.source === 'stripe' && !ending ? (
            <Card className="flex flex-col gap-2">
              <p className="text-base font-bold" style={{ color: colors.ink }}>
                Change size
              </p>
              {VIDEO_STORAGE_PLANS.filter((p) => p.gb !== info.gb).map((plan) => (
                <div key={plan.gb} className="flex items-center justify-between">
                  <span className="text-base" style={{ color: colors.ink }}>
                    {plan.name} · {plan.label} · {formatPlanPrice(plan)}
                  </span>
                  <Button size="sm" variant="secondary" label="Switch" onClick={() => changeSize(plan.gb)} loading={manage.isPending} />
                </div>
              ))}
            </Card>
          ) : null}
        </>
      ) : null}

      {info.canManage && videos.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
            Stored videos
          </p>
          {videos.map((video) => (
            <Card key={video.id} className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold" style={{ color: colors.ink }}>
                  {video.title || video.fileName}
                </p>
                <p className="text-xs" style={{ color: colors.inkMuted }}>
                  {CONTEXT_LABEL[video.context]} · {formatBytes(video.sizeBytes)} · {dateLabel(video.createdAt)}
                </p>
              </div>
              <Button size="sm" variant="danger" label="Delete" onClick={() => confirmDelete(video)} />
            </Card>
          ))}
        </div>
      ) : null}

      {info.entitled && info.canManage && !ending ? (
        <div>
          <Button variant="ghost" label="Cancel video storage" onClick={goCancel} />
        </div>
      ) : null}
      {info.entitled && (info.source === 'apple' || info.source === 'google') ? (
        <p className="text-center text-xs" style={{ color: colors.inkMuted }}>
          This storage is billed through {info.source === 'apple' ? 'the App Store' : 'Google Play'}.
        </p>
      ) : null}
    </div>
  );
}
