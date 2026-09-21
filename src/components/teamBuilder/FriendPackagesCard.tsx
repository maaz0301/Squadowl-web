'use client';

import { memo, useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Avatar, Badge, Button, Card, Checkbox, Input, Modal, ModalFooter, useAlert } from '@/components/ui';
import { useSetFriendPackagesMutation } from '@/features/queries';
import { queryKeys } from '@/lib/queryClient';
import { generateId, playerDisplayName } from '@/data/rubrics';
import type { FriendPackage } from '@/data/teamBuilder';
import type { Player, Tryout } from '@/data/types';

/** A package needs at least two players to mean anything — one player is just a player. */
const MIN_MEMBERS = 2;

/** Generous ceiling on how many packages one evaluation can define. */
const MAX_PACKAGES = 100;

/**
 * One colour per package, cycled by position — the same device the team columns
 * use. The colour, not the name, is what makes a group scannable once there are
 * several of them stacked in a narrow sidebar.
 */
const PACKAGE_ACCENTS = ['#38bdf8', '#22c55e', '#a78bfa', '#f472b6', '#facc15', '#2dd4bf'] as const;

/**
 * One picker row. Memoised so ticking a player re-renders that row alone — the
 * roster can run to a thousand players, and rebuilding every row on each click
 * was a large part of the modal feeling stuck.
 */
const PickerRow = memo(function PickerRow({
  player,
  selected,
  claimedBy,
  onToggle,
}: {
  player: Player;
  selected: boolean;
  claimedBy?: string;
  onToggle: (playerId: string) => void;
}) {
  const colors = useThemeColors();
  return (
    <div
      className="flex items-center gap-2 border-b px-3 transition-colors last:border-b-0"
      style={{
        borderColor: colors.border,
        // Picked rows are tinted rather than only ticked: with a
        // long roster the checkbox column alone is easy to lose
        // track of while scrolling.
        backgroundColor: selected ? 'rgba(255,107,43,0.10)' : 'transparent',
      }}
    >
      <Checkbox
        checked={selected}
        onChange={() => onToggle(player.id)}
        disabled={!!claimedBy}
        label={
          <span className="flex min-w-0 items-center gap-2">
            <Avatar first={player.first} last={player.last} pos={player.pos} uri={player.avatarUrl} size={24} />
            <span className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-[13px]" style={{ color: colors.ink }}>
                {playerDisplayName(player)}
              </span>
              {claimedBy ? (
                <span className="truncate text-[11px]" style={{ color: colors.inkFaint }}>
                  Already in &ldquo;{claimedBy}&rdquo;
                </span>
              ) : null}
            </span>
          </span>
        }
      />
    </div>
  );
});

interface Props {
  tryout: Tryout;
  /** Disabled while a split is generating, so the roster can't change under the build. */
  disabled?: boolean;
}

/**
 * Friend packages a coach builds by hand: pick the players who must end up on
 * the same team, name the group, and every Generate from here on keeps them
 * together.
 *
 * These sit alongside the groups the builder infers from the friend names on
 * registration forms — see resolveFriendPackages(), which puts the hand-built
 * ones first — so this screen is for the cases the forms don't capture:
 * carpools, siblings with different surnames, a coach's own kid.
 */
export function FriendPackagesCard({ tryout, disabled }: Props) {
  const colors = useThemeColors();
  const { confirm, alert } = useAlert();
  const setFriendPackages = useSetFriendPackagesMutation();
  const qc = useQueryClient();

  const [editing, setEditing] = useState<FriendPackage | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [search, setSearch] = useState('');

  const packages = useMemo(() => tryout.friendPackages ?? [], [tryout.friendPackages]);

  const playerById = useMemo(
    () => new Map(tryout.roster.map((p) => [p.id, p])),
    [tryout.roster],
  );

  // Players already spoken for by a *different* package. One player in two
  // packages would silently lose one of them at build time (buildTeams maps
  // each player to the first package that claims them), so the picker takes
  // them off the table instead and says which group has them.
  const claimedElsewhere = useMemo(() => {
    const map = new Map<string, string>();
    for (const pkg of packages) {
      if (pkg.id === editing?.id) continue;
      for (const id of pkg.playerIds) map.set(id, pkg.name);
    }
    return map;
  }, [packages, editing?.id]);

  const sortedRoster = useMemo(
    () =>
      [...tryout.roster].sort((a, b) =>
        `${a.last}${a.first}`.localeCompare(`${b.last}${b.first}`),
      ),
    [tryout.roster],
  );

  const selectedIds = useMemo(() => new Set(editing?.playerIds ?? []), [editing?.playerIds]);

  const visibleRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedRoster;
    return sortedRoster.filter((p) => playerDisplayName(p).toLowerCase().includes(q));
  }, [sortedRoster, search]);

  const save = async (next: FriendPackage[]) => {
    await setFriendPackages.mutateAsync({ id: tryout.id, packages: next });
  };

  const openNew = () => {
    setIsNew(true);
    setSearch('');
    setEditing({
      id: generateId('pkg'),
      name: `Package ${packages.length + 1}`,
      playerIds: [],
    });
  };

  const openEdit = (pkg: FriendPackage) => {
    setIsNew(false);
    setSearch('');
    setEditing({ ...pkg, playerIds: [...pkg.playerIds] });
  };

  const toggleMember = useCallback((playerId: string) => {
    setEditing((cur) =>
      cur
        ? {
            ...cur,
            playerIds: cur.playerIds.includes(playerId)
              ? cur.playerIds.filter((id) => id !== playerId)
              : [...cur.playerIds, playerId],
          }
        : cur,
    );
  }, []);

  const handleSave = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) {
      await alert('Name required', 'Give the package a name so you can recognise it later.');
      return;
    }
    if (editing.playerIds.length < MIN_MEMBERS) {
      await alert(
        'Pick at least two players',
        'A friend package is the group that has to stay together, so it needs at least two players.',
      );
      return;
    }
    const saved: FriendPackage = { ...editing, name };
    const next = isNew
      ? [...packages, saved]
      : packages.map((p) => (p.id === saved.id ? saved : p));
    // Close and show the package straight away instead of holding the dialog open
    // behind a spinner for the round trip (it reads and rewrites the tryout's
    // stored data). If the save is refused the cache goes back to what it was and
    // the coach is told, with the dialog reopened so nothing they picked is lost.
    const key = queryKeys.tryout(tryout.id);
    const previous = qc.getQueryData<Tryout>(key);
    qc.setQueryData<Tryout | undefined>(key, (cur) => (cur ? { ...cur, friendPackages: next } : cur));
    const draft = editing;
    setEditing(null);
    try {
      await save(next);
    } catch (e) {
      qc.setQueryData(key, previous);
      setIsNew(isNew);
      setEditing(draft);
      await alert('Could not save', e instanceof Error ? e.message : 'The package was not saved.');
    }
  };

  const handleDelete = async (pkg: FriendPackage) => {
    const ok = await confirm({
      title: 'Delete this package?',
      message: `"${pkg.name}" will no longer be kept together when you generate teams. The players stay on the roster.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await save(packages.filter((p) => p.id !== pkg.id));
    } catch (e) {
      await alert('Could not delete', e instanceof Error ? e.message : 'The package was not deleted.');
    }
  };

  const memberNames = (pkg: FriendPackage) =>
    pkg.playerIds
      .map((id) => playerById.get(id))
      .filter((p): p is Player => !!p)
      .map((p) => playerDisplayName(p));

  return (
    <>
      <Card accent className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
            🤝 Friend Packages
          </span>
          {packages.length > 0 ? (
            <Badge label={`${packages.length} kept together`} variant="success" />
          ) : null}
        </div>

        <p className="text-xs leading-relaxed" style={{ color: colors.inkMuted }}>
          Players in a package land on the same team when you generate. Groups picked up from
          friend names on registration forms are kept too, and a package you build here wins
          wherever the two disagree.
        </p>

        {packages.length === 0 ? (
          <div
            className="flex flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-6 text-center"
            style={{ borderColor: colors.border }}
          >
            <span aria-hidden className="text-2xl">
              🤝
            </span>
            <p className="text-sm font-bold" style={{ color: colors.ink }}>
              No packages yet
            </p>
            <p className="text-xs" style={{ color: colors.inkMuted }}>
              Group the players who have to stay together — carpools, siblings, a coach&apos;s own kid.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {packages.map((pkg, index) => {
              const names = memberNames(pkg);
              // A package whose players have since left the roster is not
              // silently dropped here — resolveFriendPackages() ignores the
              // missing members at build time, and this says so out loud so the
              // coach can fix it rather than wonder why the group split up.
              const missing = pkg.playerIds.length - names.length;
              const accent = PACKAGE_ACCENTS[index % PACKAGE_ACCENTS.length];
              return (
                <div
                  key={pkg.id}
                  className="relative flex flex-col gap-2 overflow-hidden rounded-xl border p-3 pl-4"
                  style={{ backgroundColor: colors.tile, borderColor: `${accent}55` }}
                >
                  {/* The colour rail is what tells two packages apart in a
                      narrow column faster than reading either name. */}
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-1.5"
                    style={{ backgroundColor: accent }}
                  />
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold" style={{ color: colors.ink }}>
                        {pkg.name}
                      </p>
                      <p className="text-[11px]" style={{ color: missing > 0 ? colors.warning : colors.inkMuted }}>
                        {names.length} player{names.length === 1 ? '' : 's'}
                        {missing > 0 ? ` · ${missing} no longer on the roster` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button label="Edit" size="sm" variant="secondary" onClick={() => openEdit(pkg)} disabled={disabled} />
                      <Button
                        label="✕"
                        size="sm"
                        variant="ghost"
                        title="Delete package"
                        aria-label={`Delete ${pkg.name}`}
                        onClick={() => handleDelete(pkg)}
                        disabled={disabled}
                        style={{ color: colors.danger }}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {pkg.playerIds.map((id) => {
                      const p = playerById.get(id);
                      if (!p) return null;
                      return (
                        <span
                          key={id}
                          className="flex items-center gap-1 rounded-full border py-0.5 pl-0.5 pr-2 text-[11px] font-medium"
                          style={{ borderColor: `${accent}55`, backgroundColor: `${accent}14`, color: colors.ink }}
                        >
                          <Avatar first={p.first} last={p.last} pos={p.pos} uri={p.avatarUrl} size={18} />
                          {playerDisplayName(p)}
                        </span>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <Button
          label="＋ Create Friend Package"
          onClick={openNew}
          disabled={disabled || tryout.roster.length < MIN_MEMBERS || packages.length >= MAX_PACKAGES}
        />
        {tryout.roster.length < MIN_MEMBERS ? (
          <p className="text-[11px]" style={{ color: colors.inkFaint }}>
            Add at least two players to the roster first.
          </p>
        ) : packages.length >= MAX_PACKAGES ? (
          <p className="text-[11px]" style={{ color: colors.inkFaint }}>
            Limit of {MAX_PACKAGES} packages reached.
          </p>
        ) : null}
      </Card>

      <Modal
        visible={!!editing}
        title={isNew ? 'Create Friend Package' : 'Edit Friend Package'}
        onClose={() => setEditing(null)}
        size="md"
        hideDefaultFooter
        footer={
          <ModalFooter>
            <Button label="Cancel" variant="ghost" onClick={() => setEditing(null)} />
            <Button label="Save Package" onClick={handleSave} />
          </ModalFooter>
        }
      >
        {editing ? (
          <div className="flex flex-col gap-3">
            <Input
              label="Package name"
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. Carpool group"
            />

            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-bold" style={{ color: colors.ink }}>
                Players
              </span>
              <Badge
                label={`${editing.playerIds.length} selected`}
                variant={editing.playerIds.length >= MIN_MEMBERS ? 'success' : 'info'}
              />
            </div>

            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search the roster..."
            />

            <div
              className="flex max-h-[45vh] flex-col overflow-y-auto rounded-xl border"
              style={{ borderColor: colors.border }}
            >
              {visibleRoster.length === 0 ? (
                <p className="p-3 text-xs" style={{ color: colors.inkMuted }}>
                  No players match &ldquo;{search}&rdquo;.
                </p>
              ) : (
                visibleRoster.map((p) => (
                  <PickerRow
                    key={p.id}
                    player={p}
                    selected={selectedIds.has(p.id)}
                    claimedBy={claimedElsewhere.get(p.id)}
                    onToggle={toggleMember}
                  />
                ))
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
