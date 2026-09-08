'use client';
'use no memo';

import { useMemo, useRef, useState } from 'react';
import { useForm, Controller, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { AddPlayerFormSchema, type AddPlayerForm as AddPlayerFormType, type Athlete } from '@/data/types';
import { Avatar, Button, FormLock, Input, Modal, PhoneField, Textarea, YearField, useAlert } from '@/components/ui';
import { useAthletesQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

interface Props {
  loading?: boolean;
  defaultValues?: Partial<AddPlayerFormType>;
  /**
   * `inviteEmails` is the addresses the coach marked with the Invite buttons.
   * Undefined means they marked none and the caller decides who to mail.
   */
  onSubmit: (data: AddPlayerFormType, inviteEmails?: string[]) => Promise<void>;
  /**
   * Show an Invite toggle beside each email — only where an invite has
   * somewhere to go (a team roster).
   *
   * A toggle rather than a send button, because an invite is addressed to a
   * player on a roster and this form's player has not been saved onto one yet.
   * Marking an address costs nothing and creates nobody; the save that creates
   * the player is what mails them, which is also what kept this off the old
   * three-step path of save, reopen the profile, invite from there.
   */
  showInvite?: boolean;
  /**
   * Names what saving does where it also mails the player — a coach shouldn't
   * have to discover from the confirmation that "Save Player" sent an invite.
   */
  submitLabel?: string;
}

/**
 * Sits inside the email field. `sm` is still too tall for a 48px input, so the
 * height and padding are trimmed rather than a new Button size being invented
 * for the one place that needs it.
 */
function InviteToggle({
  email,
  marked,
  onToggle,
}: {
  email: string;
  marked: boolean;
  onToggle: () => void;
}) {
  const disabled = !email.trim();
  return (
    // The title rides on a wrapper, not the button: a disabled control fires no
    // mouse events, so its own tooltip would never open — and with no address
    // typed in, why it is unavailable is exactly what a coach hovers to find.
    <span
      className="inline-flex"
      title={
        disabled
          ? 'Enter an email address to invite it.'
          : marked
            ? 'This address is invited when you save the player.'
            : 'Invite this address when you save the player.'
      }
    >
      <Button
        // Fixed width so marking it doesn't resize the button out from under
        // the padding the field reserves for it and onto the address.
        label={marked ? '✓ Invite' : 'Invite'}
        aria-pressed={marked}
        variant={marked ? 'primary' : 'secondary'}
        size="sm"
        className="min-h-[32px] w-[72px] px-0 py-1 text-xs"
        disabled={disabled}
        onClick={onToggle}
      />
    </span>
  );
}

export function AddPlayerForm({
  loading,
  defaultValues,
  onSubmit,
  showInvite,
  submitLabel = 'Save Player',
}: Props) {
  const colors = useThemeColors();
  const { alert } = useAlert();
  const athletesQuery = useAthletesQuery();
  const [modalVisible, setModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(defaultValues?.avatarUrl || null);
  /**
   * Which email fields the coach marked for an invite — the field, not the
   * address, so editing the address after marking it still sends to what ends
   * up in the box.
   */
  const [invited, setInvited] = useState<Record<'playerEmail' | 'guardianEmail', boolean>>({
    playerEmail: false,
    guardianEmail: false,
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const { control, handleSubmit, setValue, watch } = useForm<AddPlayerFormType>({
    resolver: zodResolver(AddPlayerFormSchema),
    defaultValues: {
      athleteId: defaultValues?.athleteId || '',
      first: defaultValues?.first || '',
      last: defaultValues?.last || '',
      jersey: defaultValues?.jersey || '',
      pos: defaultValues?.pos || 'FWD',
      shoots: defaultValues?.shoots || '',
      yearOfBirth: defaultValues?.yearOfBirth || '',
      positionTryingOutFor: defaultValues?.positionTryingOutFor || '',
      playerEmail: defaultValues?.playerEmail || '',
      guardianName: defaultValues?.guardianName || '',
      guardianEmail: defaultValues?.guardianEmail || '',
      guardianPhone: defaultValues?.guardianPhone || '',
      currentTeam: defaultValues?.currentTeam || '',
      currentLevel: defaultValues?.currentLevel || '',
      aboutChild: defaultValues?.aboutChild || '',
      medicalInfo: defaultValues?.medicalInfo || '',
      friend1Name: defaultValues?.friend1Name || '',
      friend2Name: defaultValues?.friend2Name || '',
      avatarUrl: defaultValues?.avatarUrl || '',
    },
  });

  const firstVal = watch('first');
  const lastVal = watch('last');


  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPhotoUri(url);
    setValue('avatarUrl', url);
  };

  const filteredAthletes = useMemo(() => {
    if (!athletesQuery.data) return [];
    const q = searchQuery.toLowerCase();
    return athletesQuery.data.filter(
      (a) => a.first.toLowerCase().includes(q) || a.last.toLowerCase().includes(q),
    );
  }, [athletesQuery.data, searchQuery]);

  const selectAthlete = (a: Athlete) => {
    setValue('athleteId', a.id);
    setValue('first', a.first);
    setValue('last', a.last);
    setValue('yearOfBirth', a.yearOfBirth || '');
    setValue('playerEmail', a.playerEmail || '');
    setValue('guardianName', a.guardianName || '');
    setValue('guardianEmail', a.guardianEmail || '');
    setValue('guardianPhone', a.guardianPhone || '');
    setValue('medicalInfo', a.medicalInfo || '');
    setValue('aboutChild', a.aboutChild || '');
    setValue('pos', a.currentPosition || 'FWD');
    setValue('currentTeam', a.currentTeam || '');
    setValue('currentLevel', a.currentLevel || '');
    setValue('jersey', a.jersey || '');
    setValue('avatarUrl', a.avatarUrl || '');
    setPhotoUri(a.avatarUrl || null);
    setModalVisible(false);
  };

  const reportInvalid = async (errors: FieldErrors<AddPlayerFormType>) => {
    const emailError = errors.guardianEmail ?? errors.playerEmail;
    if (emailError) {
      const message = emailError.message || 'Please enter a valid email address';
      await alert(message.includes('required') ? 'Email Required' : 'Invalid Email', message);
    } else {
      await alert('Validation Error', 'Please check the highlighted fields before saving.');
    }
  };

  const submit = handleSubmit(async (data) => {
    // Marked nothing: say nothing, and let the caller mail whoever it would
    // have. Marked something: those addresses and no others.
    const marked = (['playerEmail', 'guardianEmail'] as const)
      .filter((f) => invited[f])
      .map((f) => (data[f] || '').trim())
      .filter(Boolean);
    await onSubmit(data, marked.length > 0 ? marked : undefined);
  }, reportInvalid);

  return (
    <div className="flex flex-col gap-4 pb-2">
      <FormLock busy={loading} className="flex flex-col gap-4">
        {athletesQuery.data && athletesQuery.data.length > 0 ? (
          <Button label="Search Existing Players" variant="secondary" onClick={() => setModalVisible(true)} />
        ) : null}

        <Modal visible={modalVisible} title="Select Existing Player" onClose={() => setModalVisible(false)}>
          <Input
            label="Search by name"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          <div className="mt-4 flex flex-col gap-2">
            {filteredAthletes.map((a) => (
              <button
                type="button"
                key={a.id}
                className="rounded-xl border p-3 text-left transition-colors hover:brightness-125"
                style={{ borderColor: colors.border, backgroundColor: colors.card }}
                onClick={() => selectAthlete(a)}
              >
                <span className="block font-bold" style={{ color: colors.ink }}>
                  {a.first} {a.last}
                </span>
                {a.yearOfBirth ? (
                  <span className="block text-xs" style={{ color: colors.inkMuted }}>
                    Born: {a.yearOfBirth}
                  </span>
                ) : null}
                {(a.pastSeasonsCount ?? 0) > 0 ? (
                  <span className="mt-1 block text-xs" style={{ color: colors.primary }}>
                    Played in {a.pastSeasonsCount} previous season{a.pastSeasonsCount === 1 ? '' : 's'}
                  </span>
                ) : null}
              </button>
            ))}
            {filteredAthletes.length === 0 ? (
              <p className="mt-4 text-center italic" style={{ color: colors.inkMuted }}>
                No players found.
              </p>
            ) : null}
          </div>
        </Modal>

        <div className="my-1 flex flex-col items-center gap-2">
          <Avatar first={firstVal || 'P'} last={lastVal || 'L'} size={96} uri={photoUri || undefined} />
          <Button
            label={photoUri ? 'Change Photo' : 'Add Photo'}
            variant="secondary"
            size="sm"
            onClick={() => fileRef.current?.click()}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => pickPhoto(e.target.files?.[0])}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Controller
            control={control}
            name="first"
            render={({ field, fieldState }) => (
              <Input label="First Name *" {...field} error={fieldState.error?.message} />
            )}
          />
          <Controller
            control={control}
            name="last"
            render={({ field, fieldState }) => (
              <Input label="Last Name *" {...field} error={fieldState.error?.message} />
            )}
          />
          <Controller
            control={control}
            name="jersey"
            render={({ field, fieldState }) => (
              <Input label="Jersey #" inputMode="numeric" {...field} error={fieldState.error?.message} />
            )}
          />
          <Controller
            control={control}
            name="pos"
            render={({ field, fieldState }) => (
              <Input
                label="Position (FWD/DEF/GTL)"
                {...field}
                onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                error={fieldState.error?.message}
              />
            )}
          />
          <Controller
            control={control}
            name="yearOfBirth"
            render={({ field, fieldState }) => (
              <YearField label="Year of Birth" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
            )}
          />
          <Controller
            control={control}
            name="playerEmail"
            render={({ field, fieldState }) => (
              <Input
                label="Player Email"
                type="email"
                {...field}
                error={fieldState.error?.message}
                className={showInvite ? 'pr-[92px]' : undefined}
                rightAccessory={
                  showInvite ? (
                    <InviteToggle
                      email={field.value || ''}
                      marked={invited.playerEmail}
                      onToggle={() => setInvited((v) => ({ ...v, playerEmail: !v.playerEmail }))}
                    />
                  ) : undefined
                }
              />
            )}
          />
          <Controller
            control={control}
            name="guardianName"
            render={({ field, fieldState }) => (
              <Input label="Guardian Name" {...field} error={fieldState.error?.message} />
            )}
          />
          <Controller
            control={control}
            name="guardianEmail"
            render={({ field, fieldState }) => (
              <Input
                label="Guardian Email"
                type="email"
                hint="A player or guardian email is required."
                {...field}
                error={fieldState.error?.message}
                className={showInvite ? 'pr-[92px]' : undefined}
                rightAccessory={
                  showInvite ? (
                    <InviteToggle
                      email={field.value || ''}
                      marked={invited.guardianEmail}
                      onToggle={() => setInvited((v) => ({ ...v, guardianEmail: !v.guardianEmail }))}
                    />
                  ) : undefined
                }
              />
            )}
          />
          <Controller
            control={control}
            name="guardianPhone"
            render={({ field, fieldState }) => (
              <PhoneField label="Guardian Phone" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
            )}
          />
        </div>

        <Controller
          control={control}
          name="medicalInfo"
          render={({ field, fieldState }) => (
            <Textarea label="Medical Info" rows={2} {...field} error={fieldState.error?.message} />
          )}
        />

      </FormLock>

      <Button label={submitLabel} onClick={submit} loading={loading} size="lg" />
    </div>
  );
}
