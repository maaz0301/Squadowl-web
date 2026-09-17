'use client';

import { useState } from 'react';
import Link from 'next/link';
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
  Modal,
  ModalFooter,
  Select,
  Spinner,
  Switch,
  useAlert,
} from '@/components/ui';
import type {
  DiscountCode,
  DiscountCodeInput,
  DiscountDuration,
  DiscountKind,
  PaidPlanTier,
} from '@/data/founder/types';
import {
  useDiscountCodesQuery,
  useDiscountRedemptionsQuery,
  useSaveDiscountCodeMutation,
} from '@/features/founderQueries';
import { formatDate, planLabel } from '../labels';
import { discountLabel, discountState, discountTiersLabel, errorMessage, formatMoney } from './format';

const PAID_TIERS: PaidPlanTier[] = ['coach', 'coach_plus', 'club'];

function inputOf(d: DiscountCode): DiscountCodeInput {
  return {
    code: d.code,
    description: d.description,
    kind: d.kind,
    percentOff: d.percentOff,
    amountOffCents: d.amountOffCents,
    duration: d.duration,
    durationMonths: d.durationMonths,
    maxUses: d.maxUses,
    maxUsesPerAccount: d.maxUsesPerAccount,
    planTiers: d.planTiers,
    expiresAt: d.expiresAt,
    active: d.active,
  };
}

export function DiscountCodesView() {
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const query = useDiscountCodesQuery();
  const save = useSaveDiscountCodeMutation();
  const [editing, setEditing] = useState<DiscountCode | 'new' | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggleActive = async (d: DiscountCode) => {
    if (d.active) {
      const ok = await confirm({
        title: 'Deactivate Code',
        message: `${d.code} will stop working at checkout right away. Discounts already applied to subscriptions stay.`,
        confirmLabel: 'Deactivate',
        destructive: true,
      });
      if (!ok) return;
    }
    setBusyId(d.id);
    try {
      await save.mutateAsync({ id: d.id, input: { ...inputOf(d), active: !d.active } });
      toast(d.active ? `${d.code} deactivated.` : `${d.code} activated.`, 'success');
    } catch (e) {
      await alert('Could Not Update', errorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  if (query.isLoading) return <LoadingState message="Loading discount codes..." />;
  if (query.isError) {
    return <ErrorState message={errorMessage(query.error, 'Could not load discount codes.')} onRetry={() => query.refetch()} />;
  }
  const codes = query.data ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs" style={{ color: colors.inkFaint }}>
          Customers enter a code on the Upgrade page. Uses are counted when a checkout completes.
        </p>
        <Button label="New Code" onClick={() => setEditing('new')} />
      </div>

      {codes.length === 0 ? (
        <EmptyState title="No discount codes yet" message="Create one to offer a % or $ discount at checkout." />
      ) : (
        <div className="flex flex-col gap-2">
          {codes.map((d) => {
            const state = discountState(d);
            return (
              <Card key={d.id} className="flex flex-col gap-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-bold tracking-wide" style={{ color: colors.ink }}>
                        {d.code}
                      </span>
                      <Badge label={state.label} variant={state.variant} />
                    </div>
                    <p className="text-sm" style={{ color: colors.inkMuted }}>
                      {discountLabel(d)} · {discountTiersLabel(d)}
                    </p>
                    {d.description ? (
                      <p className="text-xs break-words" style={{ color: colors.inkFaint }}>
                        {d.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button label="Edit" size="sm" variant="secondary" onClick={() => setEditing(d)} />
                    <Button
                      label={d.active ? 'Deactivate' : 'Activate'}
                      size="sm"
                      variant={d.active ? 'danger' : 'secondary'}
                      loading={busyId === d.id}
                      onClick={() => toggleActive(d)}
                    />
                  </div>
                </div>
                <p className="text-xs tabular-nums" style={{ color: colors.inkFaint }}>
                  {d.uses}
                  {d.maxUses ? ` / ${d.maxUses}` : ''} use{d.uses === 1 && !d.maxUses ? '' : 's'}
                  {d.maxUsesPerAccount ? ` · ${d.maxUsesPerAccount} per organization` : ''} · {d.accountsUsed} org
                  {d.accountsUsed === 1 ? '' : 's'} · {formatMoney(d.discountTotalCents)} discounted
                  {d.expiresAt ? ` · expires ${formatDate(d.expiresAt)}` : ' · no expiry'}
                  {d.lastUsedAt ? ` · last used ${formatDate(d.lastUsedAt)}` : ''}
                </p>
                {d.uses > 0 ? (
                  <button
                    type="button"
                    className="self-start text-xs font-semibold underline-offset-2 hover:underline"
                    style={{ color: colors.primary }}
                    onClick={() => setOpenId((cur) => (cur === d.id ? null : d.id))}
                    aria-expanded={openId === d.id}
                  >
                    {openId === d.id ? 'Hide redemptions' : 'Who used it'}
                  </button>
                ) : null}
                {openId === d.id ? <Redemptions codeId={d.id} /> : null}
              </Card>
            );
          })}
        </div>
      )}

      {editing ? (
        <DiscountCodeModal
          key={editing === 'new' ? 'new' : editing.id}
          code={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function Redemptions({ codeId }: { codeId: string }) {
  const colors = useThemeColors();
  const query = useDiscountRedemptionsQuery(codeId);
  if (query.isLoading) return <Spinner />;
  if (query.isError) {
    return (
      <p className="text-sm" style={{ color: colors.danger }}>
        {errorMessage(query.error)}
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5 border-t pt-2" style={{ borderColor: colors.border }}>
      {(query.data ?? []).map((r) => (
        <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span className="min-w-0 break-words">
            {r.accountId ? (
              <Link
                href={`/founder/organizations/${r.accountId}`}
                className="font-semibold underline-offset-2 hover:underline"
                style={{ color: colors.ink }}
              >
                {r.accountName ?? 'Unnamed account'}
              </Link>
            ) : (
              <span style={{ color: colors.inkMuted }}>Deleted account</span>
            )}
            <span className="text-xs" style={{ color: colors.inkFaint }}>
              {r.ownerEmail ? ` · ${r.ownerEmail}` : ''}
              {r.planTier ? ` · ${planLabel(r.planTier)}` : ''}
            </span>
          </span>
          <span className="text-xs tabular-nums" style={{ color: colors.inkMuted }}>
            −{formatMoney(r.discountCents)} · {formatDate(r.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ─── Create / edit ──────────────────────────────────────────────────────────

const KIND_OPTIONS: { value: DiscountKind; label: string }[] = [
  { value: 'percent', label: 'Percent off (%)' },
  { value: 'amount', label: 'Amount off (CAD $)' },
];

const DURATION_OPTIONS: { value: DiscountDuration; label: string }[] = [
  { value: 'once', label: 'First payment only' },
  { value: 'repeating', label: 'For a number of months' },
  { value: 'forever', label: 'Every payment, forever' },
];

const PER_ORG_OPTIONS = [
  { value: '', label: 'No limit per organization' },
  { value: '1', label: '1 per organization' },
  { value: '2', label: '2 per organization' },
  { value: '3', label: '3 per organization' },
];

const dateKey = (ms?: number) => {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function randomCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint32Array(8)), (n) => alphabet[n % alphabet.length]).join('');
}

/** Blank → undefined; anything else must be a positive whole number. */
function optionalCount(value: string): number | undefined | null {
  if (!value.trim()) return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function DiscountCodeModal({ code, onClose }: { code: DiscountCode | null; onClose: () => void }) {
  const colors = useThemeColors();
  const { alert, toast } = useAlert();
  const save = useSaveDiscountCodeMutation();
  const locked = !!code && code.uses > 0;

  const [name, setName] = useState(code?.code ?? '');
  const [description, setDescription] = useState(code?.description ?? '');
  const [kind, setKind] = useState<DiscountKind>(code?.kind ?? 'percent');
  const [value, setValue] = useState(
    code ? (code.kind === 'percent' ? String(code.percentOff ?? '') : ((code.amountOffCents ?? 0) / 100).toFixed(2)) : '',
  );
  const [duration, setDuration] = useState<DiscountDuration>(code?.duration ?? 'once');
  const [months, setMonths] = useState(String(code?.durationMonths ?? 3));
  const [maxUses, setMaxUses] = useState(code?.maxUses ? String(code.maxUses) : '');
  const [perOrg, setPerOrg] = useState(code?.maxUsesPerAccount ? String(code.maxUsesPerAccount) : '1');
  const [tiers, setTiers] = useState<PaidPlanTier[]>(code?.planTiers ?? []);
  const [expires, setExpires] = useState(dateKey(code?.expiresAt));
  const [active, setActive] = useState(code?.active ?? true);

  const submit = async () => {
    const normalized = name.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,40}$/.test(normalized)) {
      await alert('Check the Code', 'Use 3–40 letters, numbers, dashes or underscores.');
      return;
    }
    const n = Number(value);
    if (kind === 'percent' && !(n > 0 && n <= 100)) {
      await alert('Check the Discount', 'Percent off must be more than 0 and at most 100.');
      return;
    }
    if (kind === 'amount' && !(n >= 0.01)) {
      await alert('Check the Discount', 'Enter an amount of at least $0.01.');
      return;
    }
    const monthCount = Number(months);
    if (duration === 'repeating' && !(Number.isInteger(monthCount) && monthCount >= 1 && monthCount <= 36)) {
      await alert('Check the Duration', 'Enter 1 to 36 months.');
      return;
    }
    const total = optionalCount(maxUses);
    if (total === null) {
      await alert('Check the Limit', 'Total uses must be a whole number, or blank for unlimited.');
      return;
    }
    const expiresAt = expires ? new Date(`${expires}T23:59:59`).getTime() : undefined;
    if (expiresAt && expiresAt <= Date.now() && active) {
      await alert('Check the Expiry', 'That date has already passed.');
      return;
    }

    try {
      await save.mutateAsync({
        id: code?.id ?? null,
        input: {
          code: normalized,
          description: description.trim() || undefined,
          kind,
          percentOff: kind === 'percent' ? n : undefined,
          amountOffCents: kind === 'amount' ? Math.round(n * 100) : undefined,
          duration,
          durationMonths: duration === 'repeating' ? monthCount : undefined,
          maxUses: total,
          maxUsesPerAccount: perOrg ? Number(perOrg) : undefined,
          planTiers: tiers,
          expiresAt,
          active,
        },
      });
      toast(code ? `${normalized} saved.` : `${normalized} created.`, 'success');
      onClose();
    } catch (e) {
      await alert('Could Not Save', errorMessage(e));
    }
  };

  const preview =
    Number(value) > 0
      ? discountLabel({
          kind,
          percentOff: Number(value),
          amountOffCents: Math.round(Number(value) * 100),
          duration,
          durationMonths: Number(months),
        })
      : null;

  return (
    <Modal
      visible
      title={code ? 'Edit Discount Code' : 'New Discount Code'}
      size="md"
      onClose={onClose}
      hideDefaultFooter
      footer={
        <ModalFooter>
          <Button label="Cancel" variant="ghost" onClick={onClose} />
          <Button label={code ? 'Save' : 'Create Code'} loading={save.isPending} onClick={submit} />
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-4">
        {locked ? (
          <p className="text-xs" style={{ color: colors.warning }}>
            This code has been used {code?.uses} time{code?.uses === 1 ? '' : 's'}, so its name and discount are
            locked. Limits, plans, expiry and description can still change.
          </p>
        ) : null}

        <div className="flex items-end gap-2">
          <Input
            label="Code"
            value={name}
            onChange={(e) => setName(e.target.value.toUpperCase())}
            placeholder="e.g. SPRING25"
            maxLength={40}
            autoCapitalize="characters"
            autoCorrect="off"
            disabled={locked}
            containerClassName="flex-1"
            className="font-mono"
          />
          {!locked ? <Button label="Generate" variant="secondary" onClick={() => setName(randomCode())} /> : null}
        </div>

        <Input
          label="Internal note (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Hockey Canada conference, Sept 2026"
          maxLength={200}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select
            label="Discount type"
            value={kind}
            onChange={(e) => setKind(e.target.value as DiscountKind)}
            options={KIND_OPTIONS}
            disabled={locked}
          />
          <Input
            label={kind === 'percent' ? 'Percent off' : 'Amount off (CAD)'}
            type="number"
            inputMode="decimal"
            min={kind === 'percent' ? 1 : 0.01}
            max={kind === 'percent' ? 100 : undefined}
            step={kind === 'percent' ? 1 : 0.01}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={kind === 'percent' ? '25' : '10.00'}
            disabled={locked}
          />
          <Select
            label="Applies to"
            value={duration}
            onChange={(e) => setDuration(e.target.value as DiscountDuration)}
            options={DURATION_OPTIONS}
            disabled={locked}
          />
          {duration === 'repeating' ? (
            <Input
              label="Months"
              type="number"
              inputMode="numeric"
              min={1}
              max={36}
              value={months}
              onChange={(e) => setMonths(e.target.value)}
              disabled={locked}
            />
          ) : null}
        </div>
        {preview ? (
          <p className="-mt-2 text-xs" style={{ color: colors.inkFaint }}>
            {preview}. Monthly checkout is hidden today, so a yearly plan&apos;s “first payment” is its first year.
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Total uses"
            type="number"
            inputMode="numeric"
            min={1}
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            placeholder="Unlimited"
            hint="e.g. 50 — blank for unlimited"
          />
          <Select label="Per organization" value={perOrg} onChange={(e) => setPerOrg(e.target.value)} options={PER_ORG_OPTIONS} />
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold" style={{ color: colors.ink }}>
            Plans
          </p>
          <p className="mb-1 text-xs" style={{ color: colors.inkFaint }}>
            Leave all unticked for every paid plan.
          </p>
          <div className="flex flex-wrap gap-x-5">
            {PAID_TIERS.map((tier) => (
              <Checkbox
                key={tier}
                label={planLabel(tier)}
                checked={tiers.includes(tier)}
                onChange={(on) => setTiers((cur) => (on ? [...cur, tier] : cur.filter((t) => t !== tier)))}
              />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 items-end gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <DateField label="Expires (optional)" value={expires} onChange={setExpires} />
            {expires ? (
              <button
                type="button"
                className="self-start text-xs underline-offset-2 hover:underline"
                style={{ color: colors.inkFaint }}
                onClick={() => setExpires('')}
              >
                Remove expiry
              </button>
            ) : null}
          </div>
          <Switch checked={active} onChange={setActive} label="Active" />
        </div>
      </div>
    </Modal>
  );
}
