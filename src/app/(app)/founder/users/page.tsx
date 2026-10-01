'use client';

import { useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, PageHeader, Tabs, useAlert } from '@/components/ui';
import { FounderNotAvailable } from '@/components/founder/FounderUi';
import { SetUserRoleModal, UserReasonModal } from '@/components/founder/UserModals';
import { ROLE_BADGE_VARIANT, formatDate, isUserBanned, roleLabel } from '@/components/founder/labels';
import type { FounderUser } from '@/data/founder/types';
import {
  useDeleteFounderUserMutation,
  useFounderUsersQuery,
  useIsFounderQuery,
  useResendFounderUserVerificationMutation,
  useResetFounderUserPasswordMutation,
  useSetFounderUserBannedMutation,
} from '@/features/founderQueries';
import { useDebouncedValue } from '@/lib/hooks';
import { scrollToTop } from '@/lib/scrollToTop';

const PAGE_SIZE = 25;

const ROLE_TABS = [
  { key: 'all', label: 'All' },
  { key: 'coach', label: 'Coach' },
  { key: 'guardian', label: 'Guardian' },
  { key: 'none', label: 'Not signed in yet' },
];

/** Founder console — founder@tryout.ca only. Same double-gated pattern as /founder (see that page). */
export default function FounderUsersPage() {
  const founderQuery = useIsFounderQuery();

  if (founderQuery.isLoading) return <LoadingState message="Loading..." />;
  if (founderQuery.data !== true) return <FounderNotAvailable />;

  return <UsersView />;
}

function UsersView() {
  const colors = useThemeColors();
  const { alert, confirm, toast } = useAlert();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('all');
  const [page, setPage] = useState(0);
  const [roleEditing, setRoleEditing] = useState<{ user: FounderUser; accountId: string } | null>(null);
  const [banning, setBanning] = useState<FounderUser | null>(null);
  const [deleting, setDeleting] = useState<FounderUser | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const query = useFounderUsersQuery({
    search: debouncedSearch || undefined,
    role: role === 'all' ? undefined : role,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const resetPassword = useResetFounderUserPasswordMutation();
  const resendVerification = useResendFounderUserVerificationMutation();
  const setBanned = useSetFounderUserBannedMutation();
  const deleteUser = useDeleteFounderUserMutation();

  const resetPage =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setPage(0);
    };

  const total = query.data?.total ?? 0;
  const items = query.data?.items ?? [];
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleResetPassword = async (u: FounderUser) => {
    if (!u.email) return;
    setBusyId(u.id);
    try {
      await resetPassword.mutateAsync({ userId: u.id, email: u.email });
      toast(`Password reset email sent to ${u.email}.`, 'success');
    } catch (e) {
      await alert('Could Not Send', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  const handleResendVerification = async (u: FounderUser) => {
    if (!u.email) return;
    setBusyId(u.id);
    try {
      await resendVerification.mutateAsync({ userId: u.id, email: u.email });
      toast(`Verification email resent to ${u.email}.`, 'success');
    } catch (e) {
      await alert('Could Not Send', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  const handleUnban = async (u: FounderUser) => {
    const ok = await confirm({
      title: 'Unban User',
      message: `Restore sign-in access for ${u.email ?? u.displayName ?? 'this user'}?`,
      confirmLabel: 'Unban',
    });
    if (!ok) return;
    setBusyId(u.id);
    try {
      await setBanned.mutateAsync({ userId: u.id, banned: false });
      toast('User unbanned.', 'success');
    } catch (e) {
      await alert('Could Not Unban', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmBan = async (reason: string) => {
    const u = banning;
    if (!u) return;
    setBusyId(u.id);
    try {
      await setBanned.mutateAsync({ userId: u.id, banned: true, reason });
      toast('User banned.', 'success');
      setBanning(null);
    } catch (e) {
      await alert('Could Not Ban', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async (reason: string) => {
    const u = deleting;
    if (!u) return;
    setBusyId(u.id);
    try {
      await deleteUser.mutateAsync({ userId: u.id, reason });
      toast('User deleted.', 'success');
      setDeleting(null);
    } catch (e) {
      await alert('Could Not Delete', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader title="User Management" subtitle="People who belong to an organization. Parents who were added by a coach but have not signed in yet are under Not signed in yet." />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <Input
          containerClassName="w-full md:max-w-sm"
          value={search}
          onChange={(e) => resetPage(setSearch)(e.target.value)}
          placeholder="Search by name, email or organization..."
        />
      </div>
      <Tabs tabs={ROLE_TABS} activeKey={role} onChange={resetPage(setRole)} className="mb-4" />

      {query.isLoading ? (
        <LoadingState message="Loading users..." />
      ) : query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : 'Could not load users.'}
          onRetry={() => query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState
          title={debouncedSearch || role !== 'all' ? 'No matches' : 'No users yet'}
          message={debouncedSearch || role !== 'all' ? 'Try a different search or role.' : ''}
        />
      ) : (
        <>
          {role === 'none' ? (
            <p className="mb-3 text-sm" style={{ color: colors.inkMuted }}>
              These are parent and guardian logins created automatically when a coach adds a player with a guardian email.
              They have not signed in yet, so they do not belong to any organization.
            </p>
          ) : null}
          <p className="mb-2 text-xs" style={{ color: colors.inkMuted }}>
            {total} {total === 1 ? 'user' : 'users'}
            {query.isFetching ? ' · updating…' : ''}
          </p>
          <div className="flex flex-col gap-3" style={{ opacity: query.isPlaceholderData ? 0.6 : 1 }}>
            {items.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                busy={busyId === u.id}
                onResetPassword={() => handleResetPassword(u)}
                onResendVerification={() => handleResendVerification(u)}
                onBan={() => setBanning(u)}
                onUnban={() => handleUnban(u)}
                onDelete={() => setDeleting(u)}
                onEditRole={(accountId) => setRoleEditing({ user: u, accountId })}
              />
            ))}
          </div>
          {pageCount > 1 ? (
            <div className="mt-4 flex items-center justify-between gap-2">
              <Button
                label="Previous"
                size="sm"
                variant="secondary"
                disabled={page === 0}
                onClick={() => {
                  setPage((p) => p - 1);
                  scrollToTop();
                }}
              />
              <span className="text-sm" style={{ color: colors.inkMuted }}>
                Page {page + 1} of {pageCount}
              </span>
              <Button
                label="Next"
                size="sm"
                variant="secondary"
                disabled={page + 1 >= pageCount}
                onClick={() => {
                  setPage((p) => p + 1);
                  scrollToTop();
                }}
              />
            </div>
          ) : null}
        </>
      )}

      <SetUserRoleModal
        user={roleEditing?.user ?? null}
        accountId={roleEditing?.accountId ?? null}
        onClose={() => setRoleEditing(null)}
      />
      <UserReasonModal
        visible={!!banning}
        title="Ban User"
        message={`${banning?.email ?? banning?.displayName ?? 'This user'} will be signed out and unable to sign back in. This does not delete their data, and it can be undone.`}
        confirmLabel="Ban"
        loading={setBanned.isPending}
        onClose={() => setBanning(null)}
        onConfirm={confirmBan}
      />
      <UserReasonModal
        visible={!!deleting}
        title="Delete User"
        message={`Permanently delete the sign-in for ${deleting?.email ?? deleting?.displayName ?? 'this user'}. This cannot be undone. Their organizations, teams and evaluations are not deleted.`}
        confirmLabel="Delete"
        loading={deleteUser.isPending}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </>
  );
}

function UserRow({
  user,
  busy,
  onResetPassword,
  onResendVerification,
  onBan,
  onUnban,
  onDelete,
  onEditRole,
}: {
  user: FounderUser;
  busy: boolean;
  onResetPassword: () => void;
  onResendVerification: () => void;
  onBan: () => void;
  onUnban: () => void;
  onDelete: () => void;
  onEditRole: (accountId: string) => void;
}) {
  const colors = useThemeColors();
  const banned = isUserBanned(user.bannedUntil);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-bold break-words" style={{ color: colors.ink }}>
            {user.displayName || user.email || 'Unnamed user'}
          </p>
          {user.displayName && user.email ? (
            <p className="text-sm break-all" style={{ color: colors.inkMuted }}>
              {user.email}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          {banned ? <Badge label="Banned" variant="danger" /> : null}
          {!user.emailConfirmedAt ? <Badge label="Unverified" variant="info" /> : null}
        </div>
      </div>

      <p className="text-xs" style={{ color: colors.inkFaint }}>
        Joined {formatDate(user.createdAt)}
        {user.lastSignInAt ? ` · Last sign-in ${formatDate(user.lastSignInAt, true)}` : ' · Never signed in'}
      </p>

      {user.memberships.length ? (
        <div className="flex flex-col gap-1.5">
          {user.memberships.map((m) => (
            <div key={m.accountId} className="flex flex-wrap items-center gap-1.5">
              <Badge label={roleLabel(m.role)} variant={ROLE_BADGE_VARIANT[m.role] ?? 'info'} />
              <span className="text-sm break-words" style={{ color: colors.inkMuted }}>
                {m.accountName}
              </span>
              {m.role !== 'owner' ? (
                <Button label="Change role" size="sm" variant="ghost" disabled={busy} onClick={() => onEditRole(m.accountId)} />
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm" style={{ color: colors.inkFaint }}>
          No organization memberships
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {user.email ? (
          <Button label="Reset Password" size="sm" variant="secondary" disabled={busy} onClick={onResetPassword} />
        ) : null}
        {user.email && !user.emailConfirmedAt ? (
          <Button label="Resend Verification" size="sm" variant="secondary" disabled={busy} onClick={onResendVerification} />
        ) : null}
        {banned ? (
          <Button label="Unban" size="sm" variant="primary" disabled={busy} onClick={onUnban} />
        ) : (
          <Button label="Ban" size="sm" variant="danger" disabled={busy} onClick={onBan} />
        )}
        <Button label="Delete" size="sm" variant="danger" disabled={busy} onClick={onDelete} />
      </div>
    </Card>
  );
}
