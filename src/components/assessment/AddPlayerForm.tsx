'use client';

import { useMemo, useRef, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { AddPlayerFormSchema, type AddPlayerForm as AddPlayerFormType, type Athlete } from '@/data/types';
import { Avatar, Button, Input, Modal, PhoneField, Textarea, YearField, useAlert } from '@/components/ui';
import { useAthletesQuery } from '@/features/queries';
import { useThemeColors } from '@/theme/ThemeProvider';

interface Props {
  loading?: boolean;
  defaultValues?: Partial<AddPlayerFormType>;
  onSubmit: (data: AddPlayerFormType) => Promise<void>;
}

export function AddPlayerForm({ loading, defaultValues, onSubmit }: Props) {
  const colors = useThemeColors();
  const { alert } = useAlert();
  const athletesQuery = useAthletesQuery();
  const [modalVisible, setModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(defaultValues?.avatarUrl || null);
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

  const submit = handleSubmit(onSubmit, async (errors) => {
    if (errors.guardianEmail) {
      await alert('Invalid Email', errors.guardianEmail.message || 'Please enter a valid email address');
    } else {
      await alert('Validation Error', 'Please check the highlighted fields before saving.');
    }
  });

  return (
    <div className="flex flex-col gap-4 pb-2">
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

      <div className="grid gap-4 sm:grid-cols-2">
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
            <Input label="Jersey # *" inputMode="numeric" {...field} error={fieldState.error?.message} />
          )}
        />
        <Controller
          control={control}
          name="pos"
          render={({ field, fieldState }) => (
            <Input
              label="Position (FWD/DEF/GTL) *"
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
            <YearField label="Year of Birth *" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
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
            <Input label="Guardian Email" type="email" {...field} error={fieldState.error?.message} />
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

      <Button label="Save Player" onClick={submit} loading={loading} size="lg" />
    </div>
  );
}
