'use client';

import { useTerms, sportLabel } from '@/lib/terms';
import { useState } from 'react';
import Link from 'next/link';

import { useThemeColors } from '@/theme/ThemeProvider';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState, Modal, useAlert } from '@/components/ui';
import {
  useSeasonQuery,
  useSeasonRosterPagesQuery,
  useAddSeasonPlayerMutation,
  useImportSeasonPlayersFromTeamMutation,
  useSeasonRosterInvitesMutation,
} from '@/features/queries';
import { describeInviteResult, inviteNeedsAttention } from '@/lib/inviteResult';
import { useSeasonId } from '@/features/useSeasonId';

export default function SeasonRosterPage() {
  const terms = useTerms();
  const id = useSeasonId();
  const colors = useThemeColors();
  const { alert } = useAlert();
  const seasonQuery = useSeasonQuery(id);
  // The list reads its own paged query rather than season.roster: a season with
  // a club-sized roster took several round trips to assemble that array, and
  // this page shows a screenful at a time. Both live under the same cache key,
  // so a write that invalidates the season refreshes these pages too.
  const rosterPages = useSeasonRosterPagesQuery(id);
  const addPlayer = useAddSeasonPlayerMutation();
  const importTeam = useImportSeasonPlayersFromTeamMutation();
  const invitePlayers = useSeasonRosterInvitesMutation(id ?? '');
  const [showAdd, setShowAdd] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [jersey, setJersey] = useState('');
  const [playerEmail, setPlayerEmail] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');

  if (seasonQuery.isLoading) return <LoadingState message="Loading roster..." />;
  if (seasonQuery.isError || !seasonQuery.data) {
    return <ErrorState message="Could not load roster." onRetry={() => seasonQuery.refetch()} />;
  }

  const season = seasonQuery.data;
  const players = rosterPages.data?.pages.flatMap((p) => p.players) ?? [];

  /**
   * Add a player and link them to the portal in one step.
   *
   * The invite is what makes a roster entry useful to the family it names, so
   * it goes out with the add rather than waiting for someone to open the
   * player's profile and press Invite — which is how players ended up on
   * rosters for a whole season with no way into the portal.
   *
   * The player is on the roster whatever the invite does: the form closes
   * first, and only a bounce or a player with no address on file is worth a
   * dialog. A send that simply worked says nothing — a confirmation after
   * every add is noise.
   */
  const handleAdd = async () => {
    if (!firstName.trim() || !lastName.trim() || !id) return;
    const name = `${firstName.trim()} ${lastName.trim()}`;
    const player = await addPlayer.mutateAsync({
      seasonId: id,
      player: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        jersey: jersey.trim() || undefined,
        playerEmail: playerEmail.trim() || undefined,
        guardianEmail: guardianEmail.trim() || undefined,
      },
    });
    setFirstName('');
    setLastName('');
    setJersey('');
    setPlayerEmail('');
    setGuardianEmail('');
    setShowAdd(false);

    try {
      const result = await invitePlayers.mutateAsync({ playerIds: [player.id] });
      if (inviteNeedsAttention(result)) {
        const { title, message } = describeInviteResult(result);
        await alert(title, message);
      }
    } catch (e) {
      await alert(
        'Invite Not Sent',
        `${name} was added to the roster, but the portal invite could not be sent: ${
          e instanceof Error ? e.message : 'Unknown error'
        }`,
      );
    }
  };

  /**
   * Import the linked team's players, and link each of them to the portal.
   *
   * Same rule as adding one by hand: landing on a roster is what earns an
   * invite. Most of these athletes were already invited when they joined the
   * team, and sendSeasonRosterInvites skips an address that still has a pending
   * invite — so this reaches exactly the players who had no way in yet.
   */
  const handleImport = async () => {
    if (!id) return;
    try {
      const imported = await importTeam.mutateAsync(id);
      let note = 'Roster players imported successfully from the linked team evaluations.';
      if (imported.length > 0) {
        try {
          const result = await invitePlayers.mutateAsync({ playerIds: imported.map((p) => p.id) });
          if (inviteNeedsAttention(result)) note = `${note}\n\n${describeInviteResult(result).message}`;
        } catch (e) {
          note = `${note}\n\nPortal invites could not be sent: ${
            e instanceof Error ? e.message : 'Unknown error'
          }`;
        }
      }
      await alert('Import Complete', note);
    } catch (e) {
      await alert('Import Failed', e instanceof Error ? e.message : 'Could not import players.');
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button label="+ Add Player" onClick={() => setShowAdd(true)} />
        {season.teamId ? (
          <Button label="Import Team" variant="ghost" size="sm" loading={importTeam.isPending || invitePlayers.isPending} onClick={handleImport} />
        ) : null}
      </div>

      {/* An empty first page can mean "still loading", which must not read as
          "no players" — least of all with an Import button under it. */}
      {rosterPages.isLoading ? (
        <LoadingState message="Loading roster..." />
      ) : rosterPages.isError ? (
        <ErrorState message="Could not load the roster." onRetry={() => rosterPages.refetch()} />
      ) : players.length === 0 ? (
        <EmptyState
          title="No roster players"
          message={season.teamId ? 'Import players from the linked team evaluations or add them manually.' : 'Add players manually to get started.'}
          actionLabel={season.teamId ? 'Import from Team' : 'Add Player'}
          onAction={season.teamId ? handleImport : () => setShowAdd(true)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {players.map((item) => (
            <Link key={item.id} href={`/season/${id}/player/${item.id}`}>
              <Card interactive className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate font-bold" style={{ color: colors.ink }}>
                    {item.firstName} {item.lastName}
                  </span>
                  <span className="block truncate text-sm" style={{ color: colors.inkMuted }}>
                    #{item.jersey ?? '—'} · {item.playerEmail ?? item.guardianEmail ?? 'No email'}
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

      {rosterPages.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <Button
            label="Load more players"
            variant="secondary"
            loading={rosterPages.isFetchingNextPage}
            onClick={() => rosterPages.fetchNextPage()}
          />
        </div>
      ) : null}

      <Modal visible={showAdd} title="Add Season Player" onClose={() => setShowAdd(false)} hideDefaultFooter>
        <div className="flex flex-col gap-3">
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
          <Input label={terms.jersey} value={jersey} onChange={(e) => setJersey(e.target.value)} />
          <Input label={`${terms.player} email`} type="email" value={playerEmail} onChange={(e) => setPlayerEmail(e.target.value)} />
          <Input label="Guardian email" type="email" value={guardianEmail} onChange={(e) => setGuardianEmail(e.target.value)} />
          <Button label="Add to Roster" onClick={handleAdd} loading={addPlayer.isPending} />
        </div>
      </Modal>
    </div>
  );
}
