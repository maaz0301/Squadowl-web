'use client';

import { useEffect, useState } from 'react';

import { MapLocationHint } from '@/components/MapLink';
import { Button, DateField, Input, Modal, TimeField, useAlert } from '@/components/ui';
import { useUpdateTryoutMutation } from '@/features/queries';
import { END_BEFORE_START_MESSAGE, isEndAfterStart } from '@/data/timeRange';
import type { TryoutSummary } from '@/data/types';

/**
 * The fields of an evaluation a coach edits after creating it — the same set
 * the Evaluation Settings "Edit Details" dialog offers, reachable straight from
 * the dashboard's Evaluation Actions sheet instead of navigating to the
 * evaluation's Settings page to find it.
 *
 * Fed from the list summary rather than the full evaluation, so opening it
 * costs no read at all.
 */
export function EditEvaluationModal({
  tryout,
  onClose,
}: {
  /** The evaluation being edited; null keeps the dialog closed. */
  tryout: Pick<TryoutSummary, 'id' | 'name' | 'tryoutDate' | 'startTime' | 'endTime' | 'rink'> | null;
  onClose: () => void;
}) {
  const { alert } = useAlert();
  const updateTryout = useUpdateTryoutMutation();
  const [name, setName] = useState('');
  const [tryoutDate, setTryoutDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [rink, setRink] = useState('');
  const [endTimeError, setEndTimeError] = useState('');

  // Reseeded whenever a different evaluation is opened, so nothing typed into
  // one tile's dialog can leak into the next.
  const id = tryout?.id;
  useEffect(() => {
    if (!tryout) return;
    setName(tryout.name);
    setTryoutDate(tryout.tryoutDate ?? '');
    setStartTime(tryout.startTime ?? '');
    setEndTime(tryout.endTime ?? '');
    setRink(tryout.rink ?? '');
    setEndTimeError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async () => {
    if (!tryout) return;
    if (!isEndAfterStart(startTime, endTime)) {
      setEndTimeError(END_BEFORE_START_MESSAGE);
      return;
    }
    setEndTimeError('');
    try {
      // Same mapping as Evaluation Settings: a blank field is left as it was
      // rather than cleared.
      await updateTryout.mutateAsync({
        id: tryout.id,
        updates: {
          name: name.trim() || tryout.name,
          tryoutDate: tryoutDate.trim() || undefined,
          startTime: startTime.trim() || undefined,
          endTime: endTime.trim() || undefined,
          rink: rink.trim() || undefined,
        },
      });
      onClose();
    } catch (e) {
      await alert('Could Not Save', e instanceof Error ? e.message : 'The changes could not be saved. Please try again.');
    }
  };

  return (
    <Modal visible={tryout !== null} title="Edit Evaluation" onClose={onClose} hideDefaultFooter>
      <div className="flex flex-col gap-3">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <DateField label="Date" value={tryoutDate} onChange={setTryoutDate} />
        <TimeField
          label="Start Time"
          value={startTime}
          onChange={(v) => {
            setStartTime(v);
            setEndTimeError('');
          }}
        />
        <TimeField
          label="End Time"
          value={endTime}
          onChange={(v) => {
            setEndTime(v);
            setEndTimeError('');
          }}
          error={endTimeError || undefined}
        />
        <div>
          <Input
            label="Location"
            value={rink}
            onChange={(e) => setRink(e.target.value)}
            placeholder="Rink A, 55 Bloor St W, Toronto"
          />
          <MapLocationHint location={rink} />
        </div>
        <Button label="Save" onClick={save} loading={updateTryout.isPending} />
      </div>
    </Modal>
  );
}
