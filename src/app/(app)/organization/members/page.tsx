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
  const { alert } = useAlert();
  const { canManageOrganization } = usePermissions();
  const [tab, setTab] = useState<'staff' | 'guardians'>('staff');

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<OrgRole>('coach');
  const [showRolePicker, setShowRolePicker] = useState(false);
  const [selectedMemberForRole, setSelectedMemberForRole] = useState<OrgMember | null>(null);

  const { data: members = [], isLoading } = useOrgMembersQuery();
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

  const handleRemove = async (memberId: string) => {
    await removeMut.mutateAsync(memberId);
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
                <div className="mt-1.5 flex gap-2">
                  <Badge label={item.role.toUpperCase()} variant="brand" />
                  <Badge label={item.status.toUpperCase()} variant={item.status === 'active' ? 'success' : 'warning'} />
                </div>
              </div>
              {canManageOrganization && item.role !== 'admin' ? (
                <div className="flex items-center gap-2">
                  {tab === 'staff' ? (
                    <Button label="Role" variant="ghost" size="sm" onClick={() => setSelectedMemberForRole(item)} />
                  ) : (
                    <Button
                      label="Revoke"
                      variant="danger"
                      size="sm"
                      onClick={() => handleRemove(item.id)}
                      loading={removeMut.isPending && removeMut.variables === item.id}
                    />
                  )}
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
