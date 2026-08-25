'use client';

import { useState } from 'react';

import { Badge, Button, Card, Chip, Input } from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import {
  useInviteTeamManagerMutation,
  useRemoveTeamManagerMutation,
  useTeamManagersQuery,
} from '@/features/queries';
import { TEAM_MANAGER_ROLES, type TeamManagerRole } from '@/data/types';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useEffectivePlanTier } from '@/features/useEffectivePlanTier';

/**
 * CLUB mode delegation: hand this one team to another coach or manager by
 * email. They get the team, its roster, schedule, and chat — and nothing else
 * on the club's account. The club's own staff keep full access either way,
 * which is why this list never affects the inviter's own rights.
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
  const tier = useEffectivePlanTier(teamId);
  const { data: managers = [], isLoading } = useTeamManagersQuery(teamId);
  const invite = useInviteTeamManagerMutation(teamId);
  const remove = useRemoveTeamManagerMutation(teamId);

  const [email, setEmail] = useState('');
  const [role, setRole] = useState<TeamManagerRole>('manager');

  const handleInvite = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    try {
      await invite.mutateAsync({ email: trimmed, role });
      setEmail('');
      alert(
        `Access granted\n\n${trimmed} can now manage ${teamName}. They'll see it on their dashboard the next time they open the app.`,
      );
    } catch (e) {
      alert(`Could not grant access\n\n${(e as Error)?.message || 'Something went wrong.'}`);
    }
  };

  const handleRemove = (id: string, who: string) => {
    if (!confirm(`Remove ${who} from ${teamName}?`)) return;
    remove.mutate(id, {
      onError: (e) => alert(`Could not remove\n\n${(e as Error)?.message || 'Something went wrong.'}`),
    });
  };

  return (
    <PlanGate feature="teamManagers" title="Team Managers" tierOverride={tier}>
      <Card className="flex flex-col gap-3">
        <div>
          <h3 className="font-display font-bold text-base" style={{ color: colors.ink }}>
            Team Managers
          </h3>
          <p className="mt-1 text-xs" style={{ color: colors.inkMuted }}>
            Give another coach or manager access to run {teamName}. They&apos;ll see this team&apos;s roster,
            schedule, and chat — but nothing else on your account. You keep full access.
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
                  onClick={() => handleRemove(m.id, m.name || m.email)}
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
            placeholder="coach@example.com"
          />
          <div className="flex flex-wrap gap-2">
            {TEAM_MANAGER_ROLES.map((r) => (
              <Chip key={r} label={ROLE_LABEL[r]} active={role === r} onClick={() => setRole(r)} />
            ))}
          </div>
          <Button
            label="Grant Access"
            size="sm"
            disabled={!email.trim()}
            loading={invite.isPending}
            onClick={handleInvite}
          />
          <p className="text-xs" style={{ color: colors.inkMuted }}>
            If they don&apos;t have a TryoutHQ account yet, one is created and their sign-in details are
            emailed to them.
          </p>
        </div>
      </Card>
    </PlanGate>
  );
}
