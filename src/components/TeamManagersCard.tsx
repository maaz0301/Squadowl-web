'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Badge, Button, Card, Input, useAlert } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import {
  useInviteTeamManagerMutation,
  useRemoveTeamManagerMutation,
  useTeamManagersQuery,
} from '@/features/queries';
import type { TeamManagerRole } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';
import { useUser } from '@/state/authStore';

/**
 * CLUB mode delegation: hand this one team to another manager by email. They
 * get the team, its roster, schedule, chat, and its evaluations (run on the
 * club's plan) — and nothing else on the club's account. The club's own staff keep full
 * access either way, which is why this list never affects the inviter's own
 * rights.
 *
 * Every new grant here is role 'manager' — 'coach' is no longer offered as
 * an invite option (it doubles as evaluation access, which delegation
 * doesn't include), but ROLE_LABEL keeps 'coach' mapped so a row granted
 * before this change still displays correctly.
 *
 * Gated on `teamManagers` (Coach+ and Club) to match where the feature is sold.
 *
 * This card only covers granting/revoking access from the owning club's
 * side; the delegate sees the team show up (via `list_teams_managed_by_me`,
 * merged into `listTeams`) on their own dashboard and team lists.
 */

const ROLE_LABEL: Record<TeamManagerRole, string> = {
  manager: 'Manager',
  coach: 'Coach',
};

interface Props {
  teamId: string;
  teamName: string;
}

export function TeamManagersCard({ teamId, teamName }: Props) {
  const colors = useThemeColors();
  const router = useRouter();
  const user = useUser();
  const { alert, confirm, toast } = useAlert();
  const tier = useEffectivePlanTier(teamId);
  const { data: managers = [], isLoading } = useTeamManagersQuery(teamId);
  const invite = useInviteTeamManagerMutation(teamId);
  const remove = useRemoveTeamManagerMutation(teamId);

  const [email, setEmail] = useState('');

  const handleInvite = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    try {
      // 'coach' is no longer offered here — only the account's own staff
      // get evaluation access to a delegated team, so every new delegate
      // this card grants is a 'manager'. Existing 'coach'-labeled rows from
      // before this change still display and work as before.
      await invite.mutateAsync({ email: trimmed, role: 'manager' });
      setEmail('');
      await alert(
        'Access Granted',
        `${trimmed} can now manage ${teamName}. They'll see it on their dashboard the next time they open the app.`,
      );
    } catch (e) {
      await alert('Could Not Grant Access', (e as Error)?.message || 'Something went wrong.');
    }
  };

  const handleRemove = async (id: string, who: string, managerUserId?: string, managerEmail?: string) => {
    const isSelf =
      (managerUserId && user?.id && managerUserId === user.id) ||
      (managerEmail && user?.email && managerEmail.toLowerCase() === user.email.toLowerCase());

    const ok = await confirm({
      title: isSelf ? 'Remove Manager Access' : 'Remove Manager',
      message: isSelf
        ? `Are you sure you want to remove your manager access to "${teamName}"? You will no longer be able to view or manage this team.`
        : `Are you sure you want to remove ${who} from "${teamName}"?`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;

    try {
      await remove.mutateAsync(id);
      if (isSelf) {
        toast(`Removed your access to "${teamName}".`, 'default');
        router.replace('/teams');
      } else {
        toast(`Removed ${who} from team managers.`, 'success');
      }
    } catch (e) {
      await alert('Could Not Remove', (e as Error)?.message || 'Something went wrong.');
    }
  };

  return (
    <PlanGate feature="teamManagers" title="Team Managers" tierOverride={tier}>
      <Card className="flex flex-col gap-3">
        <div>
          <h3 className="font-display font-bold text-base" style={{ color: colors.ink }}>
            Team Managers
          </h3>
          <p className="mt-1 text-xs" style={{ color: colors.inkMuted }}>
            Give another manager access to run {teamName}. They&apos;ll see this team&apos;s roster,
            schedule, and chat, and can create and run its evaluations — but nothing else on your account.
            You keep full access.
          </p>
        </div>

        {isLoading ? (
          <p className="text-sm" style={{ color: colors.inkMuted }}>Loading…</p>
        ) : managers.length === 0 ? (
          <p className="text-sm" style={{ color: colors.inkMuted }}>No one else manages this team yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {managers.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-2 rounded-xl px-3 py-2"
                style={{ backgroundColor: colors.tile }}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold" style={{ color: colors.ink }}>{m.name || m.email}</p>
                  {m.name ? (
                    <p className="truncate text-xs" style={{ color: colors.inkMuted }}>{m.email}</p>
                  ) : null}
                </div>
                <Badge label={ROLE_LABEL[m.role]} variant="info" />
                <Button
                  label="Remove"
                  variant="ghost"
                  size="sm"
                  loading={remove.isPending && remove.variables === m.id}
                  onClick={() => handleRemove(m.id, m.name || m.email, m.userId, m.email)}
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Input
            label="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            autoCapitalize="none"
            placeholder="manager@example.com"
          />
          <Button
            label="Grant Access"
            size="sm"
            disabled={!email.trim()}
            loading={invite.isPending}
            onClick={handleInvite}
          />
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            They&apos;ll get an email with an Accept Invitation button. If they don&apos;t have a TryoutHQ
            account yet, the email asks them to create one first.
          </p>
        </div>
      </Card>
    </PlanGate>
  );
}
