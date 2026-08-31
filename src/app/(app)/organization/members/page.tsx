'use client';

import { useState } from 'react';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, Input, LoadingState, Modal, PageHeader, Tabs, useAlert } from '@/components/ui';
import { useInviteMemberMutation, useOrgMembersQuery, useRemoveMemberMutation, useUpdateMemberRoleMutation } from '@/features/queries';
import type { OrgMember, OrgRole } from '@/data/types';
import { usePermissions } from '@/state/authStore';

const TABS = [
  { key: 'staff', label: 'Staff' },
  { key: 'guardians', label: 'Guardians' },
];

export default function OrganizationMembersPage() {
  const colors = useThemeColors();
  const { alert, confirm } = useAlert();
  const { canManageOrganization } = usePermissions();
  const [tab, setTab] = useState<'staff' | 'guardians'>('staff');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('coach');
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [selectedMemberForRole, setSelectedMemberForRole] = useState<OrgMember | null>(null);

  // `true`: this is the one screen that lists the coaches a club has delegated
  // a single team to, alongside its own staff.
  const { data: members = [], isLoading } = useOrgMembersQuery(true);
  const inviteMut = useInviteMemberMutation();
  const updateRoleMut = useUpdateMemberRoleMutation();
  const removeMut = useRemoveMemberMutation();

  const handleInvite = async () => {
    if (!inviteEmail) return;
    try {
      await inviteMut.mutateAsync({ email: inviteEmail, role: inviteRole });
      await alert('Success', 'Invitation sent successfully.');
      setInviteEmail('');
    } catch (e) {
      await alert('Invite Failed', e instanceof Error ? e.message : 'Could not invite user.');
    }
  };

  /**
   * Removal is permanent and there is no undo — a mis-tapped row on a list this
   * dense would silently cut someone's access — so both the staff Remove and
   * the guardian Revoke confirm first, and surface a failure rather than
   * leaving the row on screen with no explanation.
   */
  const handleRemove = async (member: OrgMember) => {
    const who = member.name || member.email;
    const teams = member.teams?.length ? member.teams.join(', ') : null;

    let message: string;
    if (member.role === 'guardian') {
      message = `Revoke ${who}'s access to this organization? They will no longer see their players here.`;
    } else if (member.source === 'teamManager') {
      // Their only access *is* the delegation, so name what they lose.
      message = `Remove ${who} from this organization? They will lose ${teams ? `access to ${teams}` : 'the team delegated to them'}.`;
    } else {
      message = `Remove ${who} from this organization? They will lose access to its teams and evaluations${teams ? `, including ${teams}` : ''}.`;
    }

    const ok = await confirm({
      title: member.role === 'guardian' ? 'Revoke Access' : 'Remove Member',
      message,
      confirmLabel: member.role === 'guardian' ? 'Revoke' : 'Remove',
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeMut.mutateAsync(member.id);
    } catch (e) {
      await alert('Remove Failed', e instanceof Error ? e.message : 'Could not remove this member.');
    }
  };

  const filteredMembers = members.filter((m) => (tab === 'staff' ? m.role !== 'guardian' : m.role === 'guardian'));

  return (
    <>
      <PageHeader title="Manage Organization" showBack />
      <Tabs tabs={TABS} activeKey={tab} onChange={(k) => setTab(k as 'staff' | 'guardians')} className="mb-4" />

      {canManageOrganization && tab === 'staff' ? (
        <Card className="mb-4 flex flex-col gap-2">
          <p className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            Invite Staff
          </p>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Input label="Email Address" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </div>
            <Button label={inviteRole.toUpperCase()} variant="secondary" onClick={() => setShowRolePicker(true)} />
          </div>
          <Button label="Send Invite" onClick={handleInvite} loading={inviteMut.isPending} />
        </Card>
      ) : null}

      {isLoading ? (
        <LoadingState message="Loading members..." />
      ) : filteredMembers.length === 0 ? (
        <EmptyState
          title={tab === 'staff' ? 'No staff members' : 'No guardians'}
          message={
            tab === 'staff'
              ? 'No staff members added yet. Invite coaches or evaluators above.'
              : 'No linked guardians found in this organization.'
          }
        />
      ) : (
        <div className="flex flex-col gap-2">
          {filteredMembers.map((item) => (
            <Card key={item.id} className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold" style={{ color: colors.ink }}>
                  {item.name || item.email}
                </p>
                {item.name && item.name !== item.email ? (
                  <p className="mt-0.5 truncate text-sm" style={{ color: colors.inkMuted }}>
                    {item.email}
                  </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap gap-2">
                  <Badge label={item.role.toUpperCase()} variant="brand" />
                  <Badge label={item.status.toUpperCase()} variant={item.status === 'active' ? 'success' : 'warning'} />
                  {item.source === 'teamManager' ? <Badge label="TEAM MANAGER" variant="info" /> : null}
                </div>
                {item.teams?.length ? (
                  <p className="mt-1 truncate text-sm" style={{ color: colors.inkMuted }}>
                    Manages {item.teams.join(', ')}
                  </p>
                ) : null}
              </div>
              {canManageOrganization && item.role !== 'admin' ? (
                <div className="flex shrink-0 items-center gap-2">
                  {/* A delegated manager has no membership row, so there is no
                      organization role to change — only the team to take back. */}
                  {tab === 'staff' && item.source !== 'teamManager' ? (
                    <Button label="Role" variant="ghost" size="sm" onClick={() => setSelectedMemberForRole(item)} />
                  ) : null}
                  <Button
                    label={tab === 'staff' ? 'Remove' : 'Revoke'}
                    variant="danger"
                    size="sm"
                    onClick={() => handleRemove(item)}
                    loading={removeMut.isPending && removeMut.variables === item.id}
                  />
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <Modal visible={showRolePicker} title="Select Role" onClose={() => setShowRolePicker(false)} hideDefaultFooter>
        <div className="flex flex-col gap-2">
          {(['coach', 'assessor'] as const).map((r) => (
            <Button
              key={r}
              label={r.toUpperCase()}
              variant={inviteRole === r ? 'primary' : 'ghost'}
              onClick={() => {
                setInviteRole(r);
                setShowRolePicker(false);
              }}
            />
          ))}
        </div>
      </Modal>

      <Modal visible={!!selectedMemberForRole} title="Update Role" onClose={() => setSelectedMemberForRole(null)} hideDefaultFooter>
        <div className="flex flex-col gap-2">
          {(['coach', 'assessor'] as const).map((r) => (
            <Button
              key={r}
              label={r.toUpperCase()}
              variant={selectedMemberForRole?.role === r ? 'primary' : 'ghost'}
              onClick={async () => {
                const member = selectedMemberForRole;
                if (!member || member.role === r) {
                  setSelectedMemberForRole(null);
                  return;
                }
                try {
                  await updateRoleMut.mutateAsync({ memberId: member.id, role: r });
                  setSelectedMemberForRole(null);
                  await alert('Success', `Role updated to ${r.toUpperCase()}.`);
                } catch (e) {
                  await alert('Update Failed', e instanceof Error ? e.message : 'Could not update role.');
                }
              }}
              loading={updateRoleMut.isPending && selectedMemberForRole?.role !== r}
            />
          ))}
        </div>
      </Modal>
    </>
  );
}
