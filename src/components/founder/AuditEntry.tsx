'use client';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Card } from '@/components/ui';
import type { FounderAuditEntry } from '@/data/founder/types';
import { AUDIT_ACTION_LABEL, formatDate, planLabel } from './labels';

export function auditDetail(entry: FounderAuditEntry): string {
  const d = entry.details as Record<string, unknown>;
  switch (entry.action) {
    case 'create_org':
      return ` · owner ${d.owner_email} · ${planLabel(d.plan_tier as string)} · ${d.access}${
        d.trial_days ? ` (${d.trial_days} days)` : ''
      }`;
    case 'update_access': {
      const after = (d.after ?? {}) as Record<string, unknown>;
      return ` · now ${planLabel(after.plan_tier as string)}${after.is_comp ? ' · comp' : ''}${
        after.trial_ends_at ? ` · trial to ${formatDate(Date.parse(after.trial_ends_at as string))}` : ''
      }`;
    }
    case 'suspend':
    case 'reactivate':
      return d.from ? ` · ${d.from} → ${d.to}` : '';
    case 'update_user_role':
      return ` · ${d.user_email} · ${d.from} → ${d.to}`;
    case 'broadcast_email':
      return ` · ${d.recipient_count} recipients`;
    case 'update_team':
    case 'archive_team':
    case 'unarchive_team':
    case 'update_player':
    case 'add_player_to_team':
    case 'update_team_roster':
    case 'remove_player_from_team':
    case 'update_season':
    case 'archive_season':
    case 'unarchive_season':
    case 'add_season_event':
    case 'update_season_event':
    case 'delete_season_event':
    case 'update_tryout':
    case 'archive_tryout':
    case 'unarchive_tryout':
    case 'delete_tryout':
    case 'restore_tryout':
    case 'add_player_to_tryout':
    case 'update_participant':
    case 'remove_participant':
    case 'restore_participant':
    case 'update_assessor':
    case 'remove_assessor':
    case 'update_evaluation':
    case 'delete_evaluation':
      return d.entity_name ? ` · ${d.entity_name}` : '';
    default:
      return '';
  }
}

/** One audit row: what was done, to what, by which admin, and when. */
export function AuditEntryCard({ entry }: { entry: FounderAuditEntry }) {
  const colors = useThemeColors();
  return (
    <Card className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-semibold break-words" style={{ color: colors.ink }}>
          {AUDIT_ACTION_LABEL[entry.action] ?? entry.action}{' '}
          <span style={{ color: colors.primary }}>{entry.accountName ?? 'deleted account'}</span>
        </p>
        <span className="text-xs" style={{ color: colors.inkFaint }}>
          {formatDate(entry.createdAt, true)}
        </span>
      </div>
      <p className="text-xs break-all" style={{ color: colors.inkMuted }}>
        by {entry.actorEmail ?? 'unknown'}
        {auditDetail(entry)}
      </p>
      {entry.reason ? (
        <p className="text-sm break-words" style={{ color: colors.inkMuted }}>
          Reason: {entry.reason}
        </p>
      ) : null}
    </Card>
  );
}
