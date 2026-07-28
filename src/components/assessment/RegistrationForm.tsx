'use client';

import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { RegistrationSubmitSchema, type RegistrationSubmit } from '@/data/types';
import { Button, Input, PhoneField, Textarea, YearField } from '@/components/ui';

interface Props {
  loading?: boolean;
  /** Public registration collects the full detail set; the in-app simulator keeps it short. */
  full?: boolean;
  onSubmit: (data: RegistrationSubmit) => Promise<void>;
}

export function RegistrationForm({ loading, full, onSubmit }: Props) {
  const { control, handleSubmit } = useForm<RegistrationSubmit>({
    resolver: zodResolver(RegistrationSubmitSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      yearOfBirth: '',
      positionTryingOutFor: '',
      guardianName: '',
      guardianEmail: '',
      guardianPhone: '',
      currentTeam: '',
      currentLevel: '',
      aboutPlayer: '',
      medicalInfo: '',
      friend1Name: '',
      friend2Name: '',
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 pb-2">
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="firstName"
          render={({ field, fieldState }) => (
            <Input label="First Name" {...field} error={fieldState.error?.message} />
          )}
        />
        <Controller
          control={control}
          name="lastName"
          render={({ field, fieldState }) => (
            <Input label="Last Name" {...field} error={fieldState.error?.message} />
          )}
        />
        {full ? (
          <Controller
            control={control}
            name="yearOfBirth"
            render={({ field, fieldState }) => (
              <YearField label="Year of Birth" value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
            )}
          />
        ) : null}
        <Controller
          control={control}
          name="positionTryingOutFor"
          render={({ field }) => <Input label="Position" {...field} value={field.value ?? ''} />}
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
            <PhoneField
              label="Guardian Phone"
              value={field.value}
              onChange={field.onChange}
              error={fieldState.error?.message}
            />
          )}
        />
        {full ? (
          <>
            <Controller
              control={control}
              name="currentTeam"
              render={({ field }) => <Input label="Current Team" {...field} value={field.value ?? ''} />}
            />
            <Controller
              control={control}
              name="currentLevel"
              render={({ field }) => <Input label="Current Level" {...field} value={field.value ?? ''} />}
            />
            <Controller
              control={control}
              name="friend1Name"
              render={({ field }) => <Input label="Friend Request 1" {...field} value={field.value ?? ''} />}
            />
            <Controller
              control={control}
              name="friend2Name"
              render={({ field }) => <Input label="Friend Request 2" {...field} value={field.value ?? ''} />}
            />
          </>
        ) : null}
      </div>

      {full ? (
        <>
          <Controller
            control={control}
            name="aboutPlayer"
            render={({ field }) => (
              <Textarea label="About the Player" rows={3} {...field} value={field.value ?? ''} />
            )}
          />
          <Controller
            control={control}
            name="medicalInfo"
            render={({ field }) => (
              <Textarea label="Medical Info" rows={2} {...field} value={field.value ?? ''} />
            )}
          />
        </>
      ) : null}

      <Button type="submit" label="Submit Registration" loading={loading} size="lg" />
    </form>
  );
}
