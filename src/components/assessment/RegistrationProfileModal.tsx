'use client';

import { useTerms } from '@/lib/terms';
import type { ReactNode } from 'react';

import { Badge, Button, Modal } from '@/components/ui';
import type { Registration } from '@/data/types';
import { formatBirth } from '@/lib/birthDate';
import { useThemeColors } from '@/theme/ThemeProvider';

type Colors = ReturnType<typeof useThemeColors>;

function Row({ label, value, colors }: { label: string; value?: string; colors: Colors }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-sm" style={{ color: colors.inkMuted }}>
        {label}
      </span>
      <span
        className="flex-1 text-right text-sm font-medium"
        style={{ color: value ? colors.ink : colors.inkFaint }}
      >
        {value || '—'}
      </span>
    </div>
  );
}

function Section({ title, children, colors }: { title: string; children: ReactNode; colors: Colors }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
        {title}
      </p>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

interface RegistrationProfileModalProps {
  registration: Registration | null;
  onClose: () => void;
  /** Omitted for non-pending registrations, which have nowhere left to go. */
  onAddToRoster?: () => void;
  /** Wording for the add button: "Add to Roster" for an evaluation, "Add to Team" on a team's own page. */
  addLabel?: string;
  onDismiss?: () => void;
  /** The evaluation's own names. */
  labels?: import('@/data/types').CustomLabels;
}

/**
 * Read-only view of everything a guardian submitted through the QR form. A
 * pending registration has no athlete record yet, so there is no player profile
 * to link to — this renders straight off the registration row instead.
 */
export function RegistrationProfileModal({
  registration,
  onClose,
  onAddToRoster,
  addLabel = 'Add to Roster',
  onDismiss,
  labels,
}: RegistrationProfileModalProps) {
  const colors = useThemeColors();
  const terms = useTerms(labels);
  const r = registration;

  return (
    <Modal
      visible={!!r}
      title={r ? `${r.firstName} ${r.lastName}` : 'Registration'}
      onClose={onClose}
      hideDefaultFooter
      footer={
        <div className="mt-4 flex flex-col gap-2">
          {r?.status === 'pending' && onAddToRoster ? (
            <Button label={addLabel} onClick={onAddToRoster} />
          ) : null}
          {r?.status === 'pending' && onDismiss ? (
            <Button label="Dismiss" variant="ghost" onClick={onDismiss} />
          ) : null}
          <Button label="Close" variant="secondary" onClick={onClose} />
        </div>
      }
    >
      {r ? (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            <Badge
              label={r.status}
              variant={r.status === 'pending' ? 'warning' : r.status === 'added' ? 'success' : 'info'}
            />
            {r.paymentStatus ? (
              <Badge
                label={r.paymentStatus}
                variant={r.paymentStatus === 'paid' ? 'success' : 'warning'}
              />
            ) : null}
          </div>

          <Section title={terms.player} colors={colors}>
            <Row label="Name" value={`${r.firstName} ${r.lastName}`} colors={colors} />
            <Row label="Date of Birth" value={formatBirth(r.dateOfBirth, r.yearOfBirth)} colors={colors} />
            <Row label="Position" value={r.positionTryingOutFor} colors={colors} />
            <Row label="Current Team" value={r.currentTeam} colors={colors} />
            <Row label="Current Level" value={r.currentLevel} colors={colors} />
            <Row label="Email" value={r.playerEmail} colors={colors} />
          </Section>

          <Section title="Guardian" colors={colors}>
            <Row label="Name" value={r.guardianName} colors={colors} />
            <Row label="Email" value={r.guardianEmail} colors={colors} />
            <Row label="Phone" value={r.guardianPhone} colors={colors} />
          </Section>

          {r.friend1Name || r.friend2Name ? (
            <Section title="Friend Requests" colors={colors}>
              <Row label="Friend 1" value={r.friend1Name} colors={colors} />
              <Row label="Friend 2" value={r.friend2Name} colors={colors} />
            </Section>
          ) : null}

          {r.aboutPlayer ? (
            <Section title="About" colors={colors}>
              <p className="text-sm" style={{ color: colors.ink }}>
                {r.aboutPlayer}
              </p>
            </Section>
          ) : null}

          {r.medicalInfo ? (
            <Section title="Medical Info" colors={colors}>
              <p className="text-sm" style={{ color: colors.ink }}>
                {r.medicalInfo}
              </p>
            </Section>
          ) : null}

          <Section title="Submitted" colors={colors}>
            <Row label="Date" value={new Date(r.createdAt).toLocaleString()} colors={colors} />
          </Section>
        </div>
      ) : null}
    </Modal>
  );
}
