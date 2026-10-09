'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { useThemeColors } from '@/theme/ThemeProvider';
import { BirthDateField, Button, Card, Input, Textarea, ThemeToggle } from '@/components/ui';
import { SupabaseDataSource } from '@/data/supabase/SupabaseDataSource';
import { RegistrationSubmitSchema, type RegistrationSubmit } from '@/data/types';
import { sportProfile } from '@/data/sportProfile';

const ds = new SupabaseDataSource();

export default function PublicRegistrationPage() {
  const routeParams = useParams();
  const eventId = Array.isArray(routeParams?.eventId) ? routeParams.eventId[0] : (routeParams?.eventId as string);
  const colors = useThemeColors();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [sport, setSport] = useState<string | undefined>();
  // The link's sport decides which fields apply; unknown keeps the standard form.
  useEffect(() => {
    if (!eventId) return;
    let live = true;
    void ds.getRegistrationLinkInfo(eventId.toUpperCase()).then((info) => {
      if (live) setSport(info?.sport);
    });
    return () => {
      live = false;
    };
  }, [eventId]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { control, handleSubmit, watch, setValue, formState: { errors } } = useForm<RegistrationSubmit>({
    resolver: zodResolver(RegistrationSubmitSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      yearOfBirth: '',
      dateOfBirth: '',
      positionTryingOutFor: '',
      playerEmail: '',
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

  const onSubmit = async (data: RegistrationSubmit) => {
    if (!eventId) {
      setSubmitError('Invalid event ID');
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      await ds.submitPublicRegistration(eventId.toUpperCase(), data);

      if (data.guardianEmail) {
        try {
          await ds.sendEmail('registration_confirmation', data.guardianEmail, {
            playerName: `${data.firstName} ${data.lastName}`,
          });
        } catch (emailErr) {
          console.error('Failed to send confirmation email', emailErr);
        }
      }

      setIsSuccess(true);
    } catch (err) {
      console.error(err);
      // A closed, switched-off or unknown link is a different problem from a
      // glitch, and retrying will not help: say so instead of "try again".
      setSubmitError(
        err instanceof Error && /invalid or closed registration code/i.test(err.message)
          ? 'This registration link is closed or no longer valid. Please contact the organizer for a new one.'
          : 'Failed to register. Please try again.',
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div
        className="flex min-h-dvh items-center justify-center px-4"
        style={{
          backgroundColor: colors.bg,
          paddingTop: 'calc(2.5rem + env(safe-area-inset-top, 0px))',
          paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="w-full max-w-[520px] text-center">
          <h1 className="text-2xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            You&apos;re registered!
          </h1>
          <p className="mt-3 text-[15px]" style={{ color: colors.inkMuted }}>
            Your information has been successfully submitted. You can now close this page and wait for further
            instructions from the event coordinator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative min-h-dvh px-4"
      style={{
        backgroundColor: colors.bg,
        paddingTop: 'calc(2.5rem + env(safe-area-inset-top, 0px))',
        paddingBottom: 'calc(2.5rem + env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div
        className="absolute"
        style={{
          top: 'calc(1.25rem + env(safe-area-inset-top, 0px))',
          right: 'calc(1.25rem + env(safe-area-inset-right, 0px))',
        }}
      >
        <ThemeToggle />
      </div>
      <div className="mx-auto w-full max-w-[560px]">
        <h1 className="text-2xl font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
          Event Registration
        </h1>
        <p className="mt-2 text-[15px]" style={{ color: colors.inkMuted }}>
          Please fill out the form below to register yourself for this event.
        </p>

        <Card className="mt-5 flex flex-col gap-4">
          <Controller
            control={control}
            name="firstName"
            render={({ field }) => <Input label="First Name" {...field} error={errors.firstName?.message} />}
          />
          <Controller
            control={control}
            name="lastName"
            render={({ field }) => <Input label="Last Name" {...field} error={errors.lastName?.message} />}
          />
          {sportProfile(sport).positions ? (
            <Controller
              control={control}
              name="positionTryingOutFor"
              render={({ field }) => (
                <Input label="Position (FWD/DEF/GTL)" {...field} value={field.value ?? ''} error={errors.positionTryingOutFor?.message} />
              )}
            />
          ) : null}
          <Controller
            control={control}
            name="yearOfBirth"
            render={({ field }) => (
              <BirthDateField
                label="Date of Birth"
                year={field.value}
                dateOfBirth={watch('dateOfBirth') ?? ''}
                onChange={({ year, dateOfBirth }) => {
                  field.onChange(year);
                  setValue('dateOfBirth', dateOfBirth);
                }}
                error={errors.yearOfBirth?.message}
              />
            )}
          />

          <Controller
            control={control}
            name="playerEmail"
            render={({ field }) => (
              <Input label="Player Email" type="email" {...field} value={field.value ?? ''} error={errors.playerEmail?.message} />
            )}
          />

          <p className="mt-2 text-base font-bold" style={{ color: colors.ink }}>Guardian Information</p>

          <Controller
            control={control}
            name="guardianName"
            render={({ field }) => <Input label="Guardian Name" {...field} error={errors.guardianName?.message} />}
          />
          <Controller
            control={control}
            name="guardianEmail"
            render={({ field }) => <Input label="Guardian Email" {...field} error={errors.guardianEmail?.message} />}
          />
          <Controller
            control={control}
            name="guardianPhone"
            render={({ field }) => (
              <Input
                label="Guardian Phone"
                value={field.value ?? ''}
                onChange={(e) => {
                  if (e.target.value.replace(/\D/g, '').length <= 15) field.onChange(e.target.value);
                }}
                error={errors.guardianPhone?.message}
              />
            )}
          />

          <p className="mt-2 text-base font-bold" style={{ color: colors.ink }}>Additional Details</p>

          <Controller
            control={control}
            name="currentTeam"
            render={({ field }) => <Input label="Current Team" {...field} value={field.value ?? ''} error={errors.currentTeam?.message} />}
          />
          <Controller
            control={control}
            name="currentLevel"
            render={({ field }) => <Input label="Current Level" {...field} value={field.value ?? ''} error={errors.currentLevel?.message} />}
          />
          <Controller
            control={control}
            name="aboutPlayer"
            render={({ field }) => <Textarea label="About Player" {...field} value={field.value ?? ''} error={errors.aboutPlayer?.message} rows={2} />}
          />
          <Controller
            control={control}
            name="medicalInfo"
            render={({ field }) => <Textarea label="Medical Info" {...field} value={field.value ?? ''} error={errors.medicalInfo?.message} rows={2} />}
          />
          <Controller
            control={control}
            name="friend1Name"
            render={({ field }) => <Input label="Friend 1" {...field} value={field.value ?? ''} error={errors.friend1Name?.message} />}
          />
          <Controller
            control={control}
            name="friend2Name"
            render={({ field }) => <Input label="Friend 2" {...field} value={field.value ?? ''} error={errors.friend2Name?.message} />}
          />

          {submitError ? (
            <p className="text-sm" style={{ color: colors.danger }}>{submitError}</p>
          ) : null}

          <Button
            label={isSubmitting ? 'Registering...' : 'Complete Registration'}
            onClick={handleSubmit(onSubmit)}
            disabled={isSubmitting}
            size="lg"
          />
        </Card>
      </div>
    </div>
  );
}
