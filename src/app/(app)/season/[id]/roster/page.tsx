'use client';

import { useState } from 'react';
import Link from 'next/link';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Modal, useAlert } from '@/components/ui';
import { useSeasonQuery, useAddSeasonPlayerMutation, useImportSeasonPlayersFromTeamMutation } from '@/features/queries';
import { useSeasonId } from '@/features/useSeasonId';

export default function SeasonRosterPage() {
  const id = useSeasonId();
  const colors = useThemeColors();
  const { alert } = useAlert();
  const seasonQuery = useSeasonQuery(id);
  const addPlayer = useAddSeasonPlayerMutation();
  const importTeam = useImportSeasonPlayersFromTeamMutation();
  const [showAdd, setShowAdd] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jersey, setJersey] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');

  if (seasonQuery.isLoading) return <LoadingState message="Loading roster..." />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return <ErrorState message="Could not load roster." onRetry={() => seasonQuery.refetch()} />;
  }

  const season = seasonQuery.data;

  const handleAdd = async () => {
    if (!firstName.trim() || !lastName.trim() || !id) return;
    await addPlayer.mutateAsync({
      seasonId: id,
      player: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jersey: jersey.trim() || undefined,
        guardianEmail: guardianEmail.trim() || undefined,
      },
    });
    setFirstName('');
    setLastName('');
    setJersey('');
    setGuardianEmail('');
    setShowAdd(false);
  };

  const handleImport = async () => {
    if (!id) return;
    try {
      await importTeam.mutateAsync(id);
      await alert('Import Complete', 'Roster players imported successfully from the linked team assessments.');
    } catch (e) {
      await alert('Import Failed', e instanceof Error ? e.message : 'Could not import players.');
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button label="+ Add Player" onClick={() => setShowAdd(true)} />
        {season.teamId ? (
          <Button label="Import Team" variant="ghost" size="sm" loading={importTeam.isPending} onClick={handleImport} />
        ) : null}
      </div>

      {season.roster.length === 0 ? (
        <EmptyState
          title="No roster players"
          message={season.teamId ? 'Import players from the linked team assessments or add them manually.' : 'Add players manually to get started.'}
          actionLabel={season.teamId ? 'Import from Team' : 'Add Player'}
          onAction={season.teamId ? handleImport : () => setShowAdd(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {season.roster.map((item) => (
            <Link key={item.id} href={`/season/${id}/player/${item.id}`}>
              <Card interactive className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-bold" style={{ color: colors.ink }}>
                    {item.firstName} {item.lastName}
                  </span>
                  <span className="block truncate text-sm" style={{ color: colors.inkMuted }}>
                    #{item.jersey ?? '—'} · {item.guardianEmail ?? 'No guardian email'}
                  </span>
                </span>
                {item.portalInviteSentAt ? (
                  <Badge label="Portal invited" variant="success" />
                ) : (
                  <Badge label="No invite" variant="warning" />
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Modal visible={showAdd} title="Add Season Player" onClose={() => setShowAdd(false)} hideDefaultFooter>
        <div className="flex flex-col gap-3">
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          <Input label="Jersey" value={jersey} onChange={(e) => setJersey(e.target.value)} />
          <Input label="Guardian email" value={guardianEmail} onChange={(e) => setGuardianEmail(e.target.value)} />
          <Button label="Add to Roster" onClick={handleAdd} loading={addPlayer.isPending} />
        </div>
      </Modal>
    </div>
  );
}
