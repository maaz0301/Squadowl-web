'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { RegistrationForm } from '@/components/assessment/RegistrationForm';
import { DummyDataModal } from '@/components/DummyDataModal';
import { LimitReachedModal } from '@/components/LimitReachedModal';
import { PlanGate } from '@/components/PlanGate';
import { QrCode } from '@/components/QrCode';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  SectionLabel,
  Tabs,
  useAlert,
} from '@/components/ui';
import { canUseFeature, isAtPlayerLimit } from '@/data/plans';
import type { DummyDataOptions } from '@/data/testDataGenerator';
import {
  useAddRegistrationToRosterMutation,
  useClearTestDataMutation,
  useDismissRegistrationMutation,
  useEnsureCloudSessionMutation,
  useGenerateTestDataMutation,
  useRegistrationsQuery,
  useSubmitRegistrationMutation,
  useTryoutQuery,
} from '@/features/queries';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { useUser } from '@/state/authStore';
import { useThemeColors } from '@/theme/ThemeProvider';
import { APP_CONFIG } from '@/config/app';

type RegTab = 'pending' | 'all' | 'dismissed';

export default function RegistrationsPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const router = useRouter();
  const { alert, toast } = useAlert();
  const tryoutQuery = useTryoutQuery(id);
  const regsQuery = useRegistrationsQuery(id!);
  const ensureCloud = useEnsureCloudSessionMutation();
  const addToRoster = useAddRegistrationToRosterMutation(id!);
  const dismissReg = useDismissRegistrationMutation(id!);
  const submitReg = useSubmitRegistrationMutation(id!);
  const genTest = useGenerateTestDataMutation(id!);
  const clearTest = useClearTestDataMutation(id!);
  const user = useUser();
  const [showQr, setShowQr] = useState(false);
  const [showSimulate, setShowSimulate] = useState(false);
  const [showTestGen, setShowTestGen] = useState(false);
  const [tab, setTab] = useState<RegTab>('pending');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [limitMsg, setLimitMsg] = useState<string | null>(null);

  const isAssociation = canUseFeature(user?.planTier ?? 'free', 'enterprise');

  const cloudId = tryoutQuery.data?.cloud?.id;
  useEffect(() => {
    if (id && tryoutQuery.data && !cloudId) ensureCloud.mutate(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tryoutQuery.data, cloudId]);

  const filtered = useMemo(() => {
    const all = regsQuery.data ?? [];
    if (tab === 'all') return all;
    if (tab === 'dismissed') return all.filter((r) => r.status === 'dismissed');
    return all.filter((r) => r.status === 'pending');
  }, [regsQuery.data, tab]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return <ErrorState message="Could not load registrations." onRetry={() => tryoutQuery.refetch()} />;
  }

  const tryout = tryoutQuery.data;
  const cloudCode = tryout.cloud?.id ?? '------';
  const baseUrl =
    APP_CONFIG.webUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://aas-tryout.app');
  const registrationUrl = `${baseUrl}/register/${cloudCode}`;
  const pendingCount = (regsQuery.data ?? []).filter((r) => r.status === 'pending').length;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(registrationUrl);
      toast('Registration link copied', 'success');
    } catch {
      await alert('Registration link', registrationUrl);
    }
  };

  const toggleSelect = (regId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(regId)) next.delete(regId);
      else next.add(regId);
      return next;
    });
  };

  const bulkAdd = async () => {
    if (isAtPlayerLimit(user?.planTier ?? 'free', tryout.roster.length + selected.size - 1)) {
      setLimitMsg('You have reached the maximum number of players for your current plan.');
      return;
    }
    for (const regId of selected) {
      await addToRoster.mutateAsync(regId);
    }
    setSelected(new Set());
  };

  const exportCsv = () => {
    const data = regsQuery.data ?? [];
    if (data.length === 0) return;
    const rows = data.map(
      (r) => `${r.firstName},${r.lastName},${r.guardianEmail},${r.status},${r.paymentStatus ?? 'unpaid'}`,
    );
    const csv = `first,last,email,status,payment\n${rows.join('\n')}`;
    const filename = `${tryout.name}_regs.csv`.replace(/\s+/g, '_').toLowerCase();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const hasRubrics = (tryout.settings.customRubrics?.length ?? 0) > 0;

  const runGenerate = async (options: DummyDataOptions) => {
    try {
      const res = await genTest.mutateAsync(options);
      setShowTestGen(false);
      const parts = [
        res.registrations ? `${res.registrations} pending registrations` : null,
        res.players ? `${res.players} roster players` : null,
        res.evaluations ? `${res.evaluations} evaluations` : null,
      ].filter(Boolean);
      await alert('Dummy data added', `Created ${parts.join(', ')}.`);
    } catch (e) {
      await alert(
        'Error',
        e instanceof Error && e.message === 'NO_RUBRICS'
          ? 'Add at least one rubric before generating scored players.'
          : e instanceof Error
            ? e.message
            : 'Failed to generate dummy data.',
      );
    }
  };

  const clearTestData = async () => {
    try {
      const res = await clearTest.mutateAsync();
      await alert('Cleared', `Removed ${res.removed} generated record${res.removed === 1 ? '' : 's'}.`);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Failed to clear dummy data.');
    }
  };

  return (
    <>
      <PlanGate feature="qrRegistration" title="QR Registration (Coach+)">
        <Card accent className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <SectionLabel>Registration Code</SectionLabel>
            <p
              className="text-3xl font-bold tracking-[0.2em]"
              style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}
            >
              {cloudCode}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button label="Show QR" size="sm" onClick={() => setShowQr(true)} />
            <Button label="Copy Link" size="sm" variant="secondary" onClick={copyLink} />
            <Button label="Simulate QR Reg" size="sm" variant="ghost" onClick={() => setShowSimulate(true)} />
          </div>
        </Card>
      </PlanGate>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs
          tabs={[
            { key: 'pending', label: 'Pending', badge: pendingCount || undefined },
            { key: 'all', label: 'All' },
            { key: 'dismissed', label: 'Dismissed' },
          ]}
          activeKey={tab}
          onChange={(k) => setTab(k as RegTab)}
        />
        <span className="ml-auto flex flex-wrap gap-2">
          {tab === 'pending' && selected.size > 0 ? (
            <Button
              label={`Add ${selected.size} to Roster`}
              size="sm"
              onClick={bulkAdd}
              loading={addToRoster.isPending}
            />
          ) : null}
          <Button label="Export CSV" variant="ghost" size="sm" onClick={exportCsv} />
        </span>
      </div>

      {isAssociation ? (
        <Card className="mb-4 flex flex-col gap-2">
          <SectionLabel>Testing Tools</SectionLabel>
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            Generate a batch of realistic dummy records — pending registrations, rostered players, or both —
            optionally scored across every rubric, to test rankings, filters, and reports at scale.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button label="Dummy Data" size="sm" onClick={() => setShowTestGen(true)} />
            <Button
              label="Clear Dummy Data"
              size="sm"
              variant="ghost"
              loading={clearTest.isPending}
              onClick={clearTestData}
            />
          </div>
        </Card>
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          title={`No ${tab} registrations`}
          message="Share the QR code with athletes and guardians to register."
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((item) => (
            <Card key={item.id} className="flex flex-col gap-2">
              <div className="flex items-start justify-between gap-3">
                <span className="text-lg font-bold" style={{ color: colors.ink }}>
                  {item.firstName} {item.lastName}
                </span>
                <span className="flex flex-col items-end gap-1">
                  <Badge
                    label={item.status}
                    variant={item.status === 'pending' ? 'warning' : item.status === 'added' ? 'success' : 'info'}
                  />
                  {item.paymentStatus ? (
                    <Badge
                      label={item.paymentStatus}
                      variant={item.paymentStatus === 'paid' ? 'success' : 'warning'}
                    />
                  ) : null}
                </span>
              </div>
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                {item.guardianName} · {item.guardianEmail}
              </span>
              {item.yearOfBirth || item.positionTryingOutFor ? (
                <span className="text-sm" style={{ color: colors.inkFaint }}>
                  {[item.yearOfBirth, item.positionTryingOutFor, item.currentTeam].filter(Boolean).join(' · ')}
                </span>
              ) : null}
              {item.status === 'pending' ? (
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button
                    label={selected.has(item.id) ? 'Selected' : 'Select'}
                    size="sm"
                    variant={selected.has(item.id) ? 'primary' : 'secondary'}
                    onClick={() => toggleSelect(item.id)}
                  />
                  <Button
                    label="Add to Roster"
                    size="sm"
                    loading={addToRoster.isPending}
                    onClick={() => {
                      if (isAtPlayerLimit(user?.planTier ?? 'free', tryout.roster.length)) {
                        setLimitMsg('You have reached the maximum number of players for your current plan.');
                        return;
                      }
                      addToRoster.mutate(item.id);
                    }}
                  />
                  <Button label="Dismiss" size="sm" variant="ghost" onClick={() => dismissReg.mutate(item.id)} />
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <Modal visible={showQr} title="Registration QR" size="sm" onClose={() => setShowQr(false)}>
        <div className="flex flex-col items-center gap-4 py-4">
          <QrCode value={registrationUrl} size={220} />
          <p className="text-center text-sm" style={{ color: colors.inkMuted }}>
            Scan to register for {tryout.name}
          </p>
          <Badge label={cloudCode} variant="brand" />
          <Input readOnly value={registrationUrl} containerClassName="w-full" onFocus={(e) => e.currentTarget.select()} />
        </div>
      </Modal>

      <Modal
        visible={showSimulate}
        title="Simulate Registration"
        size="lg"
        onClose={() => setShowSimulate(false)}
        hideDefaultFooter
      >
        <RegistrationForm
          loading={submitReg.isPending}
          onSubmit={async (data) => {
            await submitReg.mutateAsync(data);
            setShowSimulate(false);
          }}
        />
      </Modal>

      <DummyDataModal
        variant="assessment"
        visible={showTestGen}
        loading={genTest.isPending}
        hasRubrics={hasRubrics}
        onAddRubrics={() => {
          setShowTestGen(false);
          router.push(href('rubrics'));
        }}
        onClose={() => setShowTestGen(false)}
        onSubmit={runGenerate}
      />

      <LimitReachedModal visible={!!limitMsg} message={limitMsg || ''} onClose={() => setLimitMsg(null)} />
    </>
  );
}
