'use client';

import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  Chip,
  DateField,
  EmptyState,
  ErrorState,
  FormLock,
  Input,
  LoadingState,
  Modal,
  TimeField,
  useAlert,
} from '@/components/ui';
import {
  useSeasonQuery,
  useAddSeasonEventMutation,
  useUpdateSeasonEventMutation,
  useDeleteSeasonEventMutation,
} from '@/features/queries';
import { useSeasonId } from '@/features/useSeasonId';
import { getDataSource } from '@/data';
import { CreateEventFormSchema, EVENT_KINDS, type CreateEventForm, type SeasonEvent } from '@/data/types';

export default function SeasonSchedulePage() {
  const id = useSeasonId();
  const colors = useThemeColors();
  const { alert, confirm } = useAlert();
  const searchParams = useSearchParams();
  const seasonQuery = useSeasonQuery(id);
  const [eventProgress, setEventProgress] = useState<{ done: number; total: number } | null>(null);
  const addEvent = useAddSeasonEventMutation(id ?? '', (done, total) => setEventProgress({ done, total }));
  const updateEvent = useUpdateSeasonEventMutation(id ?? '');
  const deleteEvent = useDeleteSeasonEventMutation(id ?? '');
  const [showAdd, setShowAdd] = useState(false);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [reminding, setReminding] = useState<string | null>(null);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<string[]>([]);

  const { control, handleSubmit, watch, setValue, reset, setError } = useForm<CreateEventForm>({
    resolver: zodResolver(CreateEventFormSchema),
    defaultValues: { type: 'Practice', title: '', date: '', startTime: '', location: '', playerIds: [] },
  });
  const eventType = watch('type');

  const season = seasonQuery.data;

  useEffect(() => {
    if (showAdd && !editingEventId && season?.roster) {
      setSelectedPlayerIds(season.roster.map((p) => p.id));
    }
  }, [showAdd, editingEventId, season?.roster]);

  const openAdd = () => {
    setEditingEventId(null);
    setEventProgress(null);
    reset({ type: 'Practice', title: '', date: '', startTime: '', endTime: '', location: '', notes: '', playerIds: [] });
    setShowAdd(true);
  };

  const openEdit = (event: SeasonEvent) => {
    setEditingEventId(event.id);
    setEventProgress(null);
    reset({
      type: event.type,
      title: event.title,
      date: event.date,
      startTime: event.startTime ?? '',
      endTime: event.endTime ?? '',
      location: event.location ?? '',
      notes: event.notes ?? '',
      playerIds: [],
    });
    setShowAdd(true);
  };

  const closeModal = () => {
    setShowAdd(false);
    setEditingEventId(null);
    setEventProgress(null);
    reset();
  };

  // If navigated here with an editEventId (e.g. from the Season Hub's Upcoming
  // Events), open that event in the edit modal once, after the season loads.
  const editParamHandled = useRef(false);
  useEffect(() => {
    if (editParamHandled.current || !season) return;
    const editId = searchParams.get('editEventId');
    if (!editId) return;
    const ev = season.events.find((e) => e.id === editId);
    if (ev) {
      editParamHandled.current = true;
      openEdit(ev);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, season]);

  if (seasonQuery.isLoading) return <LoadingState message="Loading schedule..." />;
  if (seasonQuery.isError || !season) {
    return <ErrorState message="Could not load schedule." onRetry={() => seasonQuery.refetch()} />;
  }

  const onSubmit = handleSubmit(
    async (data) => {
      const [y, m, d] = data.date.split('-').map(Number);
      const [hour, min] = (data.startTime || '00:00').split(':').map(Number);
      const eventDate = new Date(y, m - 1, d, hour, min);

      if (eventDate < new Date()) {
        const msg = 'Event must be scheduled from today onwards.';
        setError('date', { type: 'manual', message: msg });
        await alert('Validation Error', msg);
        return;
      }

      try {
        if (editingEventId) {
          await updateEvent.mutateAsync({
            eventId: editingEventId,
            updates: {
              type: data.type,
              title: data.title,
              date: data.date,
              startTime: data.startTime,
              endTime: data.endTime,
              location: data.location,
              notes: data.notes,
            },
          });
        } else {
          await addEvent.mutateAsync({ ...data, playerIds: selectedPlayerIds });
        }
        closeModal();
      } catch (e) {
        await alert('Error', e instanceof Error ? e.message : 'Could not save the event.');
      }
    },
    async (errors) => {
      const msg = errors.date?.message || errors.title?.message || 'Please check the required fields and date format.';
      await alert('Validation Error', msg);
    },
  );

  const sendReminder = async (event: SeasonEvent) => {
    // Recipients are derived from the RSVP rows, so a failed availability read
    // would otherwise look like an event with nobody on it and report "no
    // guardians with emails" — while the invited roster sits there unreminded.
    if (event.availabilityUnavailable && Object.keys(event.availability ?? {}).length === 0) {
      await alert(
        'RSVPs Unavailable',
        "This event's invite list couldn't be loaded, so there's no way to tell who to remind. Reload and try again.",
      );
      return;
    }
    // A partial list can still be reminded — just say so, rather than quietly
    // skipping the players whose rows never arrived.
    if (event.availabilityUnavailable) {
      const proceed = await confirm({
        title: 'Partial Invite List',
        message: "Some of this event's RSVPs couldn't be loaded. Remind only the players that did load?",
        confirmLabel: 'Send Anyway',
      });
      if (!proceed) return;
    }
    try {
      setReminding(event.id);
      const assignedRosterIds = new Set(Object.keys(event.availability || {}));
      const emails = Array.from(
        new Set(
          season.roster
            .filter((p) => assignedRosterIds.has(p.id))
            .flatMap((p) => [p.playerEmail, p.guardianEmail, ...(p.portalInviteEmails ?? [])])
            .filter(Boolean),
        ),
      );

      if (emails.length === 0) {
        await alert('No Emails', 'There are no guardians with emails in the roster.');
        return;
      }

      let sent = 0;
      for (const email of emails) {
        if (email) {
          await getDataSource().sendEmail('reminder', email, {
            title: event.title,
            message: `Don't forget! The ${event.type} "${event.title}" is coming up on ${event.date} at ${event.startTime || 'TBD'}. Location: ${event.location || 'TBD'}.`,
          });
          sent++;
        }
      }
      await alert('Reminders Sent', `Successfully sent ${sent} reminder(s).`);
    } catch (e) {
      await alert('Error', e instanceof Error ? e.message : 'Failed to send reminders.');
    } finally {
      setReminding(null);
    }
  };

  const confirmDeleteEvent = async (eventId: string, label: string) => {
    const ok = await confirm({ title: 'Delete Event', message: `Delete "${label}"?`, confirmLabel: 'Delete', destructive: true });
    if (ok) deleteEvent.mutate(eventId);
  };

  return (
    <div>
      <div className="mb-4">
        <Button label="+ Add Event" onClick={openAdd} />
      </div>

      {season.events.length === 0 ? (
        <EmptyState title="No events" message="Add your first event." />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {[...season.events]
            .sort((a, b) => a.date.localeCompare(b.date))
            .map((item) => (
              <Card key={item.id} className="flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-bold" style={{ color: colors.ink }}>{item.title}</span>
                  <Badge label={item.type} variant={item.type === 'Game' ? 'brand' : 'default'} />
                </div>
                <span style={{ color: colors.inkMuted }}>
                  {item.date} · {item.startTime ?? '—'}–{item.endTime ?? '—'}
                </span>
                {item.location ? <span style={{ color: colors.inkFaint }}>{item.location}</span> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    label="Send Reminder"
                    variant="secondary"
                    size="sm"
                    onClick={() => sendReminder(item)}
                    loading={reminding === item.id}
                  />
                  <Button label="Edit" variant="secondary" size="sm" onClick={() => openEdit(item)} />
                  <Button
                    label="Delete"
                    variant="ghost"
                    size="sm"
                    loading={deleteEvent.isPending && deleteEvent.variables === item.id}
                    onClick={() => confirmDeleteEvent(item.id, item.title)}
                  />
                </div>
              </Card>
            ))}
        </div>
      )}

      <Modal visible={showAdd} title={editingEventId ? 'Edit Event' : 'Add Event'} onClose={closeModal} hideDefaultFooter>
        <div className="flex flex-col gap-3">
          <FormLock busy={addEvent.isPending || updateEvent.isPending} className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              {EVENT_KINDS.map((t) => (
                <Chip key={t} label={t} active={eventType === t} onClick={() => setValue('type', t)} />
              ))}
            </div>
            <Controller
              control={control}
              name="title"
              render={({ field, fieldState }) => <Input label="Title" {...field} error={fieldState.error?.message} />}
            />
            <Controller
              control={control}
              name="date"
              render={({ field, fieldState }) => (
                <DateField label="Date" value={field.value} onChange={field.onChange} error={fieldState.error?.message} disablePast />
              )}
            />
            <Controller
              control={control}
              name="startTime"
              render={({ field, fieldState }) => (
                <TimeField
                  label="Start Time"
                  value={field.value}
                  onChange={field.onChange}
                  error={fieldState.error?.message}
                  disablePast
                  dateValue={watch('date')}
                />
              )}
            />
            <Controller
              control={control}
              name="location"
              render={({ field }) => <Input label="Location" {...field} value={field.value ?? ''} />}
            />
            {editingEventId ? null : (
              <>
                <p className="mt-2 text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Roster Assignment ({selectedPlayerIds.length}/{season.roster.length})
                </p>

                <div className="max-h-[150px] overflow-y-auto">
                  {season.roster.map((player) => {
                    const isSelected = selectedPlayerIds.includes(player.id);
                    return (
                      <button
                        type="button"
                        key={player.id}
                        onClick={() =>
                          setSelectedPlayerIds(
                            isSelected ? selectedPlayerIds.filter((pid) => pid !== player.id) : [...selectedPlayerIds, player.id],
                          )
                        }
                        className="flex w-full items-center justify-between border-b py-2 text-left"
                        style={{ borderColor: colors.border }}
                      >
                        <span style={{ color: colors.ink }}>
                          {player.firstName} {player.lastName}
                        </span>
                        <Badge label={isSelected ? 'Selected' : 'Deselected'} variant={isSelected ? 'success' : 'default'} />
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </FormLock>

          {addEvent.isPending && eventProgress && eventProgress.total > 0 ? (
            <div className="flex flex-col gap-1">
              <div className="h-2 w-full overflow-hidden rounded-full" style={{ backgroundColor: colors.tile }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, Math.max(4, Math.round((eventProgress.done / eventProgress.total) * 100)))}%`,
                    backgroundColor: colors.primary,
                  }}
                />
              </div>
              <p className="text-center text-xs" style={{ color: colors.inkMuted }}>
                {`Sending invites to ${eventProgress.done} of ${eventProgress.total} guardians...`}
              </p>
            </div>
          ) : null}
          <Button
            label={editingEventId ? 'Update Event' : 'Save Event'}
            onClick={onSubmit}
            loading={addEvent.isPending || updateEvent.isPending}
          />
        </div>
      </Modal>
    </div>
  );
}
