'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  PageHeader,
  Select,
  Tabs,
  useAlert,
} from '@/components/ui';
import {
  MAX_COMPARE_PLAYERS,
  MAX_COMPARE_TEAMS,
  addToSelection,
  buildComparison,
  candidateName,
  formatCompareDate,
  isTopPerformer,
  nextSort,
  type CompareCandidate,
  type CompareFilters,
  type CompareSort,
  type SavedComparison,
} from '@/data/compare';
import { getDataSource } from '@/data';
import {
  useCompareAssessmentsQuery,
  useCompareBirthYearsQuery,
  useCompareCandidatesQuery,
  useDeleteSavedComparisonMutation,
  useSaveComparisonMutation,
  useSavedComparisonsQuery,
  useTeamsQuery,
  useUpdateSavedComparisonMutation,
} from '@/features/queries';
import { buildCompareFile } from '@/lib/compareExport';
import { download } from '@/lib/exportData';
import { reportLogoUrls } from '@/lib/reportPdf';
import { useUser } from '@/state/authStore';

const ROW_HEIGHT = 64;
const LIST_HEIGHT = 440;

type DobMode = 'year' | 'range';

export default function ComparePage() {
  const colors = useThemeColors();
  const user = useUser();
  const { alert, confirm } = useAlert();

  const [tab, setTab] = useState<'select' | 'results' | 'saved'>('select');

  // Filters
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [dobMode, setDobMode] = useState<DobMode>('year');
  const [year, setYear] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters: CompareFilters = useMemo(
    () => ({
      query: debounced || undefined,
      teamIds: teamIds.length ? teamIds : undefined,
      year: dobMode === 'year' && year ? year : undefined,
      from: dobMode === 'range' && from ? from : undefined,
      to: dobMode === 'range' && to ? to : undefined,
    }),
    [debounced, teamIds, dobMode, year, from, to],
  );

  // Selection. `known` keeps every player seen so far, so a chosen player stays
  // on the comparison after a filter change drops them from the picker.
  const [selected, setSelected] = useState<string[]>([]);
  const [known, setKnown] = useState<Map<string, CompareCandidate>>(new Map());
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<CompareSort>({ key: 'rank', dir: 'asc' });
  const [openSaved, setOpenSaved] = useState<SavedComparison | null>(null);

  const teamsQuery = useTeamsQuery();
  const yearsQuery = useCompareBirthYearsQuery();
  const candidatesQuery = useCompareCandidatesQuery(filters);
  const pool = useMemo(() => candidatesQuery.data?.pages.flatMap((p) => p.rows) ?? [], [candidatesQuery.data]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toggle = useCallback((c: CompareCandidate) => {
    setKnown((prev) => (prev.has(c.id) ? prev : new Map(prev).set(c.id, c)));
    setSelected((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : addToSelection(prev, [c.id])));
  }, []);
  const [selectingAll, setSelectingAll] = useState(false);
  const selectAll = async () => {
    setSelectingAll(true);
    try {
      // The filtered pool can be larger than what has scrolled in, so ask for the first 100.
      const page = await getDataSource().listCompareCandidates(filters, 0, MAX_COMPARE_PLAYERS);
      setKnown((prev) => {
        const next = new Map(prev);
        for (const c of page.rows) next.set(c.id, c);
        return next;
      });
      setSelected((prev) => addToSelection(prev, page.rows.map((c) => c.id)));
      if (page.next != null) {
        await alert('Selection limit', `Added the first ${MAX_COMPARE_PLAYERS} players. Narrow the filters to pick the rest.`);
      }
    } catch (e) {
      await alert('Could not select', e instanceof Error ? e.message : 'Could not load the players.');
    } finally {
      setSelectingAll(false);
    }
  };

  const toggleTeam = (id: string) =>
    setTeamIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : prev.length < MAX_COMPARE_TEAMS ? [...prev, id] : prev));

  // Results
  const assessmentsQuery = useCompareAssessmentsQuery(tab === 'results' ? selected : []);
  const candidates = useMemo(() => selected.map((id) => known.get(id)).filter((c): c is CompareCandidate => !!c), [selected, known]);
  const table = useMemo(
    () =>
      assessmentsQuery.data
        ? buildComparison({ candidates, assessments: assessmentsQuery.data, selectedIds: selected, choices, sort })
        : null,
    [assessmentsQuery.data, candidates, selected, choices, sort],
  );

  // Saved comparisons
  const savedQuery = useSavedComparisonsQuery();
  const saveMutation = useSaveComparisonMutation();
  const updateMutation = useUpdateSavedComparisonMutation();
  const deleteMutation = useDeleteSavedComparisonMutation();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');

  const savedInput = (name: string) => ({ name, athleteIds: selected, choices, filters, sort });
  const doSave = async (asNew: boolean) => {
    const name = saveName.trim();
    if (!name) {
      await alert('Name needed', 'Give the comparison a name, like "U10 All Teams Oct 2026".');
      return;
    }
    try {
      if (openSaved && !asNew) {
        const updated = await updateMutation.mutateAsync({ id: openSaved.id, input: savedInput(name) });
        setOpenSaved(updated);
      } else {
        const created = await saveMutation.mutateAsync(savedInput(name));
        setOpenSaved(created);
      }
      setSaveOpen(false);
    } catch (e) {
      await alert('Could not save', e instanceof Error ? e.message : 'Could not save this comparison.');
    }
  };

  const openComparison = async (saved: SavedComparison) => {
    setSelected(saved.athleteIds);
    setChoices(saved.choices);
    setSort(saved.sort);
    setOpenSaved(saved);
    setSaveName(saved.name);
    // Names for the table come from the picker's cache; fetch any not seen yet.
    try {
      const ids = new Set(saved.athleteIds);
      const missing = saved.athleteIds.filter((id) => !known.has(id));
      if (missing.length) {
        const page = await getDataSource().listCompareCandidates({}, 0, 200);
        // The saved players may sit beyond one page; page on until every one is found or the list ends.
        let rows = page.rows;
        let next = page.next;
        const found = new Map<string, CompareCandidate>();
        const take = (list: CompareCandidate[]) => list.forEach((c) => ids.has(c.id) && found.set(c.id, c));
        take(rows);
        while (found.size < missing.length && next != null) {
          const more = await getDataSource().listCompareCandidates({}, next, 200);
          rows = more.rows;
          next = more.next;
          take(rows);
        }
        setKnown((prev) => {
          const m = new Map(prev);
          found.forEach((c, id) => m.set(id, c));
          return m;
        });
      }
    } catch {
      // The table still opens; players that could not be named are left out.
    }
    setTab('results');
  };

  const removeSaved = async (saved: SavedComparison) => {
    const ok = await confirm({
      title: 'Delete comparison',
      message: `Delete "${saved.name}"? The players and their scores are not affected.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMutation.mutateAsync(saved.id);
      if (openSaved?.id === saved.id) setOpenSaved(null);
    } catch (e) {
      await alert('Could not delete', e instanceof Error ? e.message : 'Could not delete this comparison.');
    }
  };

  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null);
  const exportAs = async (format: 'pdf' | 'xlsx') => {
    if (!table) return;
    setExporting(format);
    try {
      const file = await buildCompareFile({
        title: openSaved?.name || saveName.trim() || 'Player comparison',
        table,
        format,
        logoUrls: reportLogoUrls({ club: user?.planTier === 'club', organizationLogoUrl: user?.organizationLogoUrl, appLogo: true }),
      });
      download(file.fileName, file.content, 'base64', file.mimeType);
    } catch (e) {
      await alert('Export failed', e instanceof Error ? e.message : 'Could not build the file.');
    } finally {
      setExporting(null);
    }
  };

  const clearAll = () => {
    setSelected([]);
    setChoices({});
    setOpenSaved(null);
  };

  const years = yearsQuery.data ?? [];

  return (
    <>
      <PageHeader title="Compare" subtitle="Rank any players on your account side by side, across teams and seasons." />

      <Tabs
        tabs={[
          { key: 'select', label: 'Select players', badge: selected.length || undefined },
          { key: 'results', label: 'Comparison' },
          { key: 'saved', label: 'Saved', badge: savedQuery.data?.length || undefined },
        ]}
        activeKey={tab}
        onChange={(k) => setTab(k as typeof tab)}
        className="mb-4"
      />

      {tab === 'select' ? (
        <div className="flex flex-col gap-4">
          <Card className="flex flex-col gap-4">
            <Input
              label="Player name"
              placeholder="Search by first or last name"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search players by name"
            />

            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                Teams ({teamIds.length} / {MAX_COMPARE_TEAMS})
              </p>
              <div className="flex flex-wrap gap-2">
                {(teamsQuery.data ?? []).map((t) => (
                  <Chip
                    key={t.id}
                    label={t.name}
                    active={teamIds.includes(t.id)}
                    disabled={!teamIds.includes(t.id) && teamIds.length >= MAX_COMPARE_TEAMS}
                    onClick={() => toggleTeam(t.id)}
                  />
                ))}
                {teamsQuery.data && !teamsQuery.data.length ? (
                  <span className="text-sm" style={{ color: colors.inkMuted }}>
                    No teams yet. Players from evaluations still appear below.
                  </span>
                ) : null}
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                  Birth date
                </p>
                <Chip label="Year" active={dobMode === 'year'} onClick={() => setDobMode('year')} />
                <Chip label="Date range" active={dobMode === 'range'} onClick={() => setDobMode('range')} />
              </div>
              {dobMode === 'year' ? (
                <Select
                  aria-label="Birth year"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  options={[{ value: '', label: 'Any birth year' }, ...years.map((y) => ({ value: y, label: y }))]}
                />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input label="From" type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
                  <Input label="To" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
                </div>
              )}
            </div>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-auto text-base font-bold" style={{ color: colors.ink }} aria-live="polite">
              {selected.length} / {MAX_COMPARE_PLAYERS} selected
            </span>
            <Button label="Select all" size="sm" variant="secondary" loading={selectingAll} onClick={selectAll} />
            <Button label="Clear all" size="sm" variant="ghost" disabled={!selected.length} onClick={clearAll} />
            <Button label="Compare" size="sm" disabled={selected.length < 1} onClick={() => setTab('results')} />
          </div>

          <PickerList
            pool={pool}
            loading={candidatesQuery.isLoading}
            error={candidatesQuery.isError ? (candidatesQuery.error as Error).message : null}
            onRetry={() => candidatesQuery.refetch()}
            selectedSet={selectedSet}
            atLimit={selected.length >= MAX_COMPARE_PLAYERS}
            onToggle={toggle}
            hasMore={!!candidatesQuery.hasNextPage}
            loadingMore={candidatesQuery.isFetchingNextPage}
            onLoadMore={() => candidatesQuery.fetchNextPage()}
          />
        </div>
      ) : null}

      {tab === 'results' ? (
        selected.length === 0 ? (
          <EmptyState title="No players selected" message="Pick the players to compare on the Select players tab." />
        ) : assessmentsQuery.isLoading || !table ? (
          assessmentsQuery.isError ? (
            <ErrorState message="Could not load the comparison." onRetry={() => assessmentsQuery.refetch()} />
          ) : (
            <LoadingState />
          )
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-auto text-sm" style={{ color: colors.inkMuted }}>
                {openSaved ? <strong style={{ color: colors.ink }}>{openSaved.name} · </strong> : null}
                {table.rows.length} {table.rows.length === 1 ? 'player' : 'players'}
              </span>
              <Button
                label={openSaved ? 'Save' : 'Save comparison'}
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (!saveName) setSaveName(openSaved?.name ?? '');
                  setSaveOpen(true);
                }}
              />
              <Button label="Export PDF" size="sm" loading={exporting === 'pdf'} onClick={() => exportAs('pdf')} />
              <Button label="Export Excel" size="sm" loading={exporting === 'xlsx'} onClick={() => exportAs('xlsx')} />
            </div>
            <ResultsTable table={table} sort={sort} onSort={(key) => setSort((s) => nextSort(s, key))} onChoose={(id, tryoutId) => setChoices((c) => ({ ...c, [id]: tryoutId }))} />
          </div>
        )
      ) : null}

      {tab === 'saved' ? (
        savedQuery.isLoading ? (
          <LoadingState />
        ) : savedQuery.isError ? (
          <ErrorState message="Could not load saved comparisons." onRetry={() => savedQuery.refetch()} />
        ) : !savedQuery.data?.length ? (
          <EmptyState title="No saved comparisons" message="Save a comparison from the Comparison tab to reopen it later." />
        ) : (
          <div className="flex flex-col gap-2">
            {savedQuery.data.map((s) => (
              <Card key={s.id} className="flex flex-wrap items-center gap-3">
                <div className="mr-auto min-w-0">
                  <p className="truncate font-bold" style={{ color: colors.ink }}>
                    {s.name}
                  </p>
                  <p className="text-sm" style={{ color: colors.inkMuted }}>
                    Saved {new Date(s.updatedAt).toLocaleDateString()} · {s.athleteIds.length} players
                  </p>
                </div>
                <Button label="Open" size="sm" onClick={() => openComparison(s)} />
                <Button label="Delete" size="sm" variant="ghost" onClick={() => removeSaved(s)} />
              </Card>
            ))}
          </div>
        )
      ) : null}

      <Modal
        visible={saveOpen}
        title={openSaved ? 'Save comparison' : 'Name this comparison'}
        onClose={() => setSaveOpen(false)}
        hideDefaultFooter
        size="sm"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button label="Cancel" variant="ghost" onClick={() => setSaveOpen(false)} />
            {openSaved ? <Button label="Save as new" variant="secondary" onClick={() => doSave(true)} /> : null}
            <Button
              label={openSaved ? 'Update' : 'Save'}
              loading={saveMutation.isPending || updateMutation.isPending}
              onClick={() => doSave(false)}
            />
          </div>
        }
      >
        <Input label="Name" placeholder="U10 All Teams Oct 2026" value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={120} autoFocus />
      </Modal>
    </>
  );
}

/** Fixed-height rows in a scroll box, rendering only what is on screen, so a long pool stays smooth. */
function PickerList(props: {
  pool: CompareCandidate[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selectedSet: Set<string>;
  atLimit: boolean;
  onToggle: (c: CompareCandidate) => void;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  const colors = useThemeColors();
  const { pool, selectedSet, atLimit, onToggle, hasMore, loadingMore, onLoadMore } = props;
  const [scrollTop, setScrollTop] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const total = pool.length;
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
  const end = Math.min(total, Math.ceil((scrollTop + LIST_HEIGHT) / ROW_HEIGHT) + 4);

  useEffect(() => {
    // Close to the bottom of what has loaded: fetch the next page.
    if (hasMore && !loadingMore && total > 0 && scrollTop + LIST_HEIGHT >= total * ROW_HEIGHT - ROW_HEIGHT * 6) onLoadMore();
  }, [scrollTop, total, hasMore, loadingMore, onLoadMore]);

  if (props.loading && !total) return <LoadingState />;
  if (props.error) return <ErrorState message={props.error} onRetry={props.onRetry} />;
  if (!total) return <EmptyState title="No players found" message="No players match these filters. Try a different name, team or birth date." />;

  return (
    <div
      ref={boxRef}
      role="listbox"
      aria-multiselectable="true"
      aria-label="Players"
      className="overflow-y-auto rounded-xl border"
      style={{ height: LIST_HEIGHT, borderColor: colors.border, backgroundColor: colors.card }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: total * ROW_HEIGHT + (hasMore ? ROW_HEIGHT : 0), position: 'relative' }}>
        {pool.slice(start, end).map((c, i) => {
          const index = start + i;
          const checked = selectedSet.has(c.id);
          const blocked = !checked && atLimit;
          return (
            <label
              key={c.id}
              role="option"
              aria-selected={checked}
              className="absolute left-0 right-0 flex cursor-pointer items-center gap-3 border-b px-4"
              style={{
                top: index * ROW_HEIGHT,
                height: ROW_HEIGHT,
                borderColor: colors.border,
                backgroundColor: checked ? 'rgba(255,107,43,0.08)' : undefined,
                opacity: blocked ? 0.45 : 1,
              }}
            >
              <input type="checkbox" checked={checked} disabled={blocked} onChange={() => onToggle(c)} className="h-5 w-5 shrink-0 accent-[#ff6b2b]" />
              <Avatar first={c.first} last={c.last} uri={c.avatarUrl} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold" style={{ color: colors.ink }}>
                  {candidateName(c)}
                </span>
                <span className="block truncate text-xs" style={{ color: colors.inkMuted }}>
                  {c.teams.length ? c.teams.map((t) => t.teamName).join(', ') : 'No team'}
                  {c.dateOfBirth ? ` · ${c.dateOfBirth}` : c.yearOfBirth ? ` · ${c.yearOfBirth}` : ''}
                </span>
              </span>
            </label>
          );
        })}
        {hasMore ? (
          <div className="absolute left-0 right-0 flex items-center justify-center text-sm" style={{ top: total * ROW_HEIGHT, height: ROW_HEIGHT, color: colors.inkMuted }}>
            {loadingMore ? 'Loading more players…' : 'Scroll for more'}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const RANK_W = 64;
const NAME_W = 200;

function ResultsTable({
  table,
  sort,
  onSort,
  onChoose,
}: {
  table: ReturnType<typeof buildComparison>;
  sort: CompareSort;
  onSort: (key: string) => void;
  onChoose: (athleteId: string, tryoutId: string) => void;
}) {
  const colors = useThemeColors();
  const arrow = (key: string) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const head = (key: string, label: string, extra?: string) => (
    <button
      type="button"
      onClick={() => onSort(key)}
      className="w-full text-left text-xs font-bold uppercase tracking-wider"
      style={{ color: sort.key === key ? colors.primary : colors.inkMuted }}
      aria-label={`Sort by ${label}`}
    >
      {label}
      {arrow(key)}
      {extra ? (
        <span className="block text-[10px] font-normal normal-case tracking-normal" style={{ color: colors.inkMuted }}>
          {extra}
        </span>
      ) : null}
    </button>
  );
  const cell = 'px-3 py-2 align-middle text-sm';
  const stickyBg = colors.card;

  if (!table.rows.length) return <EmptyState title="No players to show" message="None of the selected players could be loaded." />;

  return (
    <div className="overflow-auto rounded-xl border" style={{ maxHeight: '70vh', borderColor: colors.border }}>
      <table className="min-w-full border-separate border-spacing-0">
        <thead>
          <tr>
            <th className={`${cell} sticky left-0 top-0 z-30`} style={{ width: RANK_W, minWidth: RANK_W, backgroundColor: stickyBg, borderBottom: `1px solid ${colors.border}` }}>
              {head('rank', 'Rank')}
            </th>
            <th className={`${cell} sticky top-0 z-30`} style={{ left: RANK_W, width: NAME_W, minWidth: NAME_W, backgroundColor: stickyBg, borderBottom: `1px solid ${colors.border}`, borderRight: `1px solid ${colors.border}` }}>
              {head('name', 'Player')}
            </th>
            <th className={`${cell} sticky top-0 z-20`} style={{ backgroundColor: stickyBg, borderBottom: `1px solid ${colors.border}`, minWidth: 190 }}>
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: colors.inkMuted }}>
                Evaluation
              </span>
            </th>
            <th className={`${cell} sticky top-0 z-20`} style={{ backgroundColor: stickyBg, borderBottom: `1px solid ${colors.border}`, minWidth: 90 }}>
              {head('overall', 'Overall')}
            </th>
            {table.columns.map((c) => (
              <th key={c.id} className={`${cell} sticky top-0 z-20`} style={{ backgroundColor: stickyBg, borderBottom: `1px solid ${colors.border}`, minWidth: 110 }}>
                {head(c.id, c.label, c.benchmark ? `benchmark ${c.benchmark}` : undefined)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => {
            const rowBorder = `1px solid ${colors.border}`;
            return (
              <tr key={r.athleteId}>
                <td className={`${cell} sticky left-0 z-10 font-bold`} style={{ backgroundColor: stickyBg, borderBottom: rowBorder, color: colors.ink }}>
                  {r.rank ?? '–'}
                </td>
                <td className={`${cell} sticky z-10`} style={{ left: RANK_W, backgroundColor: stickyBg, borderBottom: rowBorder, borderRight: rowBorder }}>
                  <span className="block truncate font-bold" style={{ color: colors.ink, maxWidth: NAME_W - 24 }}>
                    {r.name}
                  </span>
                  <span className="block truncate text-xs" style={{ color: colors.inkMuted, maxWidth: NAME_W - 24 }}>
                    {r.teamNames.join(', ') || 'No team'}
                  </span>
                </td>
                <td className={cell} style={{ borderBottom: rowBorder }}>
                  {r.evaluations.length ? (
                    <>
                      <select
                        aria-label={`Evaluation for ${r.name}`}
                        value={r.assessment?.tryoutId ?? ''}
                        onChange={(e) => onChoose(r.athleteId, e.target.value)}
                        className="w-full rounded-md border bg-transparent px-2 py-1 text-xs"
                        style={{ borderColor: colors.border, color: colors.ink }}
                      >
                        {r.evaluations.map((a) => (
                          <option key={a.tryoutId} value={a.tryoutId}>
                            {a.tryoutName}
                            {a.date ? ` · ${formatCompareDate(a.date)}` : ''}
                          </option>
                        ))}
                      </select>
                      {r.assessment?.date ? (
                        <span className="mt-0.5 block text-[11px]" style={{ color: colors.inkMuted }}>
                          {formatCompareDate(r.assessment.date)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <Badge label="Not evaluated" variant="default" />
                  )}
                </td>
                <ScoreCell value={r.overall} top={isTopPerformer(table, 'overall', r.overall)} className={cell} border={rowBorder} bold />
                {table.columns.map((c) => (
                  <ScoreCell key={c.id} value={r.scores[c.id] ?? null} top={isTopPerformer(table, c.id, r.scores[c.id])} className={cell} border={rowBorder} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ScoreCell({ value, top, className, border, bold }: { value: number | null; top: boolean; className: string; border: string; bold?: boolean }) {
  const colors = useThemeColors();
  return (
    <td
      className={className}
      style={{
        borderBottom: border,
        // Subtle highlight for the best score in the column.
        backgroundColor: top ? 'rgba(34,197,94,0.14)' : undefined,
        color: top ? colors.success : colors.ink,
        fontWeight: top || bold ? 700 : 500,
      }}
    >
      {value == null ? <span style={{ color: colors.inkMuted }}>–</span> : value.toFixed(1)}
      {top ? <span className="sr-only"> (top in column)</span> : null}
    </td>
  );
}
