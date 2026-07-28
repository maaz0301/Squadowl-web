'use client';

import { useEffect, useMemo, useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingState,
  PageHeader,
  Spinner,
  Textarea,
} from '@/components/ui';
import { PlanGate } from '@/components/PlanGate';
import { useTryoutQuery, useGenerateTeamBuilderMutation } from '@/features/queries';
import { useAssessmentHref, useAssessmentId } from '@/features/useAssessmentId';
import { getPlayerNameMap, type TeamBuilderState } from '@/data/teamBuilder';
import { computePlayerResults } from '@/data/scoring';

export default function TeamBuilderPage() {
  const id = useAssessmentId();
  const href = useAssessmentHref();
  const colors = useThemeColors();
  const tryoutQuery = useTryoutQuery(id);
  const generate = useGenerateTeamBuilderMutation(id!);
  const [prompt, setPrompt] = useState('');
  const [tbLoadingText, setTbLoadingText] = useState('Analyzing players...');

  const results = useMemo(
    () => (tryoutQuery.data ? computePlayerResults(tryoutQuery.data) : []),
    [tryoutQuery.data],
  );

  useEffect(() => {
    if (!generate.isPending) {
      setTbLoadingText('Analyzing players...');
      return;
    }
    const texts = ['Analyzing players...', 'Balancing rosters...', 'Optimizing lines...', 'Finalizing teams...'];
    let idx = 0;
    const int = setInterval(() => {
      idx = (idx + 1) % texts.length;
      setTbLoadingText(texts[idx]);
    }, 2500);
    return () => clearInterval(int);
  }, [generate.isPending]);

  if (tryoutQuery.isLoading) return <LoadingState message="Loading..." />;
  if (tryoutQuery.isError || !tryoutQuery.data) {
    return (
      <>
        <PageHeader title="Team Builder" showBack />
        <ErrorState message="Could not load team builder." onRetry={() => tryoutQuery.refetch()} />
      </>
    );
  }

  const tryout = tryoutQuery.data;
  const teamBuilder = tryout.teamBuilder as TeamBuilderState | undefined;
  const nameMap = getPlayerNameMap(tryout);

  const handleGenerate = () => {
    generate.mutate({
      prompt,
      // Defaults; the backend also parses the prompt for a team count.
      teamCount: 2,
      keepFriendPackages: true,
      splitGoalies: true,
    });
  };

  return (
    <>
      <PageHeader
        title="Team Builder"
        subtitle="Sort Out — balanced teams"
        showBack
        backHref={href('results')}
      />

      <PlanGate feature="teamBuilder" title="Team Builder (Club+)">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_1fr] lg:items-start">
          <Card accent className="flex flex-col gap-3">
            <span className="font-bold" style={{ color: colors.ink, fontFamily: 'var(--font-space-grotesk)' }}>
              Configuration
            </span>
            <span className="text-sm" style={{ color: colors.inkMuted }}>
              {tryout.roster.length} players
            </span>

            <Textarea
              rows={5}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Build 4 teams, keep friend packages together, balance birth years..."
              disabled={generate.isPending}
            />

            {generate.isPending ? (
              <div className="flex flex-col items-center gap-2 p-4">
                <Spinner size={28} />
                <span style={{ color: colors.ink }}>{tbLoadingText}</span>
              </div>
            ) : (
              <Button label="✨ Generate Teams with AI" onClick={handleGenerate} />
            )}

            {generate.isError ? (
              <div className="mt-1 rounded-xl p-3" style={{ backgroundColor: colors.tile }}>
                <p className="font-bold" style={{ color: colors.ink }}>
                  Notice
                </p>
                <p className="mt-1" style={{ color: colors.inkMuted }}>
                  {generate.error?.message ||
                    'Team builder generation timed out. The server might be busy, please try again.'}
                </p>
                <Button label="Retry" size="sm" variant="secondary" className="mt-2" onClick={handleGenerate} />
              </div>
            ) : null}
          </Card>

          <div className="flex flex-col gap-4">
            {teamBuilder?.explanation ? (
              <Card style={{ borderColor: 'rgba(255,107,43,0.25)', backgroundColor: 'rgba(255,107,43,0.08)' }}>
                <p className="mb-1 font-bold" style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}>
                  ✨ AI Co-Coach Insight
                </p>
                <p style={{ color: colors.ink }}>{teamBuilder.explanation}</p>
              </Card>
            ) : null}

            {teamBuilder?.warnings?.length ? (
              <div className="flex flex-col gap-2">
                {teamBuilder.warnings.map((w, i) => {
                  // Strip UUIDs so player IDs never leak into the UI.
                  const cleanText = w
                    .replace(/\(?(ID: )?[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\)?/gi, '')
                    .trim();
                  return (
                    <div
                      key={i}
                      className="rounded-xl border p-3 text-sm font-medium"
                      style={{
                        backgroundColor: colors.warning + '15',
                        borderColor: colors.warning + '30',
                        color: colors.warning,
                      }}
                    >
                      {cleanText}
                    </div>
                  );
                })}
              </div>
            ) : null}

            {teamBuilder?.teams?.map((team) => {
              const teamPlayerResults = results.filter(
                (r) => team.players.includes(r.player.id) && r.evalCount > 0,
              );
              const avgScore =
                teamPlayerResults.length > 0
                  ? (teamPlayerResults.reduce((sum, r) => sum + r.overall, 0) / teamPlayerResults.length).toFixed(1)
                  : null;

              return (
                <Card key={team.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span
                      className="text-lg font-bold"
                      style={{ color: colors.primary, fontFamily: 'var(--font-space-grotesk)' }}
                    >
                      {team.name}
                    </span>
                    <span className="flex gap-2">
                      {avgScore ? <Badge label={`Avg: ${avgScore}`} variant="success" /> : null}
                      <Badge label={`${team.players.length} players`} />
                    </span>
                  </div>
                  {team.skaters.length > 0 ? (
                    <p className="text-sm" style={{ color: colors.inkMuted }}>
                      Skaters: {team.skaters.map((pid) => nameMap[pid] ?? pid).join(', ')}
                    </p>
                  ) : null}
                  {team.goalies.length > 0 ? (
                    <p className="text-sm" style={{ color: colors.inkFaint }}>
                      Goalies: {team.goalies.map((pid) => nameMap[pid] ?? pid).join(', ')}
                    </p>
                  ) : null}
                </Card>
              );
            })}
          </div>
        </div>
      </PlanGate>
    </>
  );
}
