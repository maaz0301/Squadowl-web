'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { useThemeColors, useTheme } from '@/theme/ThemeProvider';
import { Avatar, Badge, Button, Card, Input, PageHeader, SectionLabel, Switch, useAlert } from '@/components/ui';
import { useThemeStore } from '@/state/themeStore';
import { useUser, useAuthStore, usePermissions } from '@/state/authStore';
import { canUseFeature, formatLimit, getPlanDefinition, getTeamAllowance } from '@/data/plans';
import {
  useUpdateProfileMutation,
  useUpdatePasswordMutation,
  useUploadCoachPhotoMutation,
} from '@/features/queries';
import { useIsFounderQuery } from '@/features/founderQueries';
import { FounderProfileCard } from '@/components/founder/FounderProfileCard';
import { getDataSource } from '@/data';
import { PasswordSchema } from '@/data/types';

const QUICK_LINKS = [
  { href: '/search', label: 'Search' },
  { href: '/organization/members', label: 'Manage Organization Members' },
  { href: '/shared-athletes', label: 'Shared Athletes' },
  { href: '/archived-assessments', label: 'Archived Evaluations' },
  { href: '/feedback', label: 'Send Feedback' },
  { href: '/loyalty', label: 'Loyalty Program' },
];

export default function ProfilePage() {
  const colors = useThemeColors();
  const { isDark } = useTheme();
  const router = useRouter();
  const { alert } = useAlert();
  const user = useUser();
  const logout = useAuthStore((s) => s.logout);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const updateProfile = useUpdateProfileMutation();
  const updatePasswordMut = useUpdatePasswordMutation();
  const uploadPhoto = useUploadCoachPhotoMutation();
  const { role, isGuardian } = usePermissions();
  // The founder account runs the platform; plan limits, billing and the coach
  // quick links don't apply to it.
  const { data: founderCheck } = useIsFounderQuery(!isGuardian);
  // While viewing as an organization, show the profile the way that organization's admin would.
  const isFounder = founderCheck === true && !user?.impersonating;

  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [organization, setOrganization] = useState(user?.organization ?? '');
  const [changingPassword, setChangingPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [loadingPortal, setLoadingPortal] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const plan = getPlanDefinition(user?.planTier ?? 'coach');

  const saveProfile = async () => {
    await updateProfile.mutateAsync({
      displayName: displayName.trim() || user?.displayName,
      organization: organization.trim() || undefined,
    });
    setEditing(false);
  };

  const onPhotoPicked = async (file: File | undefined) => {
    if (!file || !user?.id) return;
    const objectUrl = URL.createObjectURL(file);
    try {
      await uploadPhoto.mutateAsync({
        userId: user.id,
        fileUri: objectUrl,
        fileType: file.type || 'image/jpeg',
      });
      await alert('Success', 'Profile picture updated successfully!');
    } catch (e) {
      await alert('Upload Error', `Failed to upload photo: ${e instanceof Error ? e.message : 'Unknown error'}`);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const savePassword = async () => {
    const validation = PasswordSchema.safeParse(password);
    if (!validation.success) {
      await alert('Validation Error', validation.error.issues[0].message);
      return;
    }
    try {
      await updatePasswordMut.mutateAsync(password);
      if (user) {
        await updateProfile.mutateAsync({
          onboardingSteps: { ...user.onboardingSteps, changePassword: true },
        });
      }
      setChangingPassword(false);
      setPassword('');
      await alert('Success', 'Password updated successfully');
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Failed to update password');
    }
  };

  const openPortal = async () => {
    try {
      setLoadingPortal(true);
      const res = await getDataSource().createPortalSession();
      if (res?.url) window.location.href = res.url;
    } catch (err) {
      await alert('Portal Error', err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setLoadingPortal(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Profile" showBack />

      <Card accent className="flex flex-col items-center gap-2 py-6">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={uploadPhoto.isPending} className="flex flex-col items-center gap-1">
          <Avatar
            first={user?.displayName?.split(' ')[0] ?? 'C'}
            last={user?.displayName?.split(' ')[1] ?? ''}
            size={88}
            uri={user?.avatarUrl}
          />
          <span className="text-xs" style={{ color: colors.primary }}>
            {uploadPhoto.isPending ? 'Uploading...' : 'Click to change photo'}
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => onPhotoPicked(e.target.files?.[0])}
        />

        {editing ? (
          <div className="mt-2 flex w-full max-w-sm flex-col gap-3">
            <Input label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            {!isFounder ? (
              <Input label="Organization" value={organization} onChange={(e) => setOrganization(e.target.value)} />
            ) : null}
            <div className="flex gap-2">
              <Button label="Save" onClick={saveProfile} loading={updateProfile.isPending} />
              <Button label="Cancel" variant="ghost" onClick={() => setEditing(false)} />
            </div>
          </div>
        ) : (
          <>
            <p className="text-xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
              {user?.displayName}
            </p>
            <p style={{ color: colors.inkMuted }}>{user?.email}</p>
            {user?.organization && !isFounder ? <p style={{ color: colors.inkFaint }}>{user.organization}</p> : null}

            <div className="mt-1 flex flex-wrap justify-center gap-2">
              {isFounder ? (
                <>
                  <Badge label="Role: Founder" variant="info" />
                  <Badge label="Platform admin" variant="brand" />
                </>
              ) : (
                <>
                  <Badge
                    label={`Role: ${
                      isGuardian ? 'Guardian' : role === 'admin' ? 'Coach' : role.charAt(0).toUpperCase() + role.slice(1)
                    }`}
                    variant="info"
                  />
                  {!isGuardian ? <Badge label={`Plan: ${plan.name}`} variant="brand" /> : null}
                  {user?.subscriptionStatus ? (
                    <Badge
                      label={user.subscriptionStatus}
                      variant={user.subscriptionStatus === 'active' ? 'success' : 'default'}
                    />
                  ) : null}
                </>
              )}
            </div>

            <div className="mt-2 flex flex-wrap justify-center gap-2">
              <Button label="Edit Account" variant="ghost" size="sm" onClick={() => setEditing(true)} />
              <Button
                label="Change Password"
                variant="secondary"
                size="sm"
                onClick={() => setChangingPassword(true)}
              />
            </div>
          </>
        )}

        {changingPassword ? (
          <div className="mt-4 flex w-full max-w-sm flex-col gap-3 border-t pt-4" style={{ borderColor: colors.border }}>
            <Input label="New Password" isPassword value={password} onChange={(e) => setPassword(e.target.value)} />
            <div className="flex gap-2">
              <Button label="Save Password" onClick={savePassword} loading={updatePasswordMut.isPending} />
              <Button
                label="Cancel"
                variant="ghost"
                onClick={() => {
                  setChangingPassword(false);
                  setPassword('');
                }}
              />
            </div>
          </div>
        ) : null}
      </Card>

      {!isGuardian ? (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {isFounder ? (
            <FounderProfileCard />
          ) : (
            <>
              <Card className="flex flex-col gap-2">
                <SectionLabel>Plan Limits</SectionLabel>
                <p style={{ color: colors.inkMuted }}>
                  Evaluations: {formatLimit(plan.limits.assessments)} · Players: {formatLimit(plan.limits.players)} ·
                  Teams: {formatLimit(getTeamAllowance(user?.planTier ?? 'free', user?.extraTeamLicenses ?? 0))}
                </p>
                {(user?.extraTeamLicenses ?? 0) > 0 ? (
                  <p className="text-xs" style={{ color: colors.inkMuted }}>
                    Includes {user?.extraTeamLicenses} purchased team license{user?.extraTeamLicenses === 1 ? '' : 's'}.
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button label="Upgrade Plan" variant="secondary" onClick={() => router.push('/upgrade')} />
                  {user?.subscriptionStatus === 'active' || user?.subscriptionStatus === 'trialing' ? (
                    <Button
                      label="Manage Subscription"
                      variant="secondary"
                      onClick={openPortal}
                      loading={loadingPortal}
                    />
                  ) : null}
                </div>
                {canUseFeature(user?.planTier ?? 'free', 'payments') ? (
                  <Button label="Payment Dashboard" variant="secondary" onClick={() => router.push('/payments')} />
                ) : null}
              </Card>

              <Card className="flex flex-col gap-1">
                <SectionLabel>Quick Links</SectionLabel>
                {QUICK_LINKS.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className="rounded-lg px-2 py-2 text-[15px] font-semibold transition-colors hover:brightness-125"
                    style={{ color: colors.ink }}
                  >
                    {l.label}
                  </Link>
                ))}
              </Card>
            </>
          )}

          <Card className="flex flex-col gap-3">
            <SectionLabel>Appearance</SectionLabel>
            <div className="flex items-center justify-between">
              <span style={{ color: colors.inkMuted }}>Dark Mode</span>
              <Switch checked={isDark} onChange={toggleTheme} />
            </div>
          </Card>
        </div>
      ) : null}

      <div className="mt-6">
        <Button
          label="Log Out"
          variant="danger"
          loading={loggingOut}
          onClick={async () => {
            setLoggingOut(true);
            try {
              await logout();
              router.push('/login');
            } finally {
              setLoggingOut(false);
            }
          }}
        />
      </div>
    </div>
  );
}
