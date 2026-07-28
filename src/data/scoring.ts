import type { AssessorProgress, PlayerResult, Recommendation, Tryout } from './types';
import {
  categoryAveragesAcrossEvals,
  getPlayerCategories,
  isGoaliePosition,
  weightedOverallAcrossEvals,
} from './rubrics';

export function computePlayerResults(tryout: Tryout): PlayerResult[] {
  return tryout.roster.map((player) => {
    const playerEvals = tryout.evals.filter((e) => e.playerId === player.id);
    const categories = getPlayerCategories(tryout.sport, player.pos, tryout.settings.customRubrics);
    const weights = isGoaliePosition(player.pos)
      ? tryout.settings.goalieWeights
      : tryout.settings.skaterWeights;

    // Scores pool across every evaluation/session, matching the web prototype.
    const categoryScores = categoryAveragesAcrossEvals(playerEvals, categories);
    const overall = playerEvals.length
      ? weightedOverallAcrossEvals(playerEvals, categories, weights)
      : 0;

    const latestEval = [...playerEvals].sort((a, b) => b.createdAt - a.createdAt)[0];

    return {
      player,
      overall,
      evalCount: playerEvals.length,
      latestRecommendation: (latestEval?.recommendation ?? '') as Recommendation,
      categoryScores,
    };
  });
}

export function computeAssessorProgress(tryout: Tryout): AssessorProgress[] {
  const assessors = tryout.assessors.length
    ? tryout.assessors.map((a) => a.name)
    : [tryout.headAssessor ?? 'Coach'];

  return assessors.map((name) => {
    const scoredPlayerIds = new Set(
      tryout.evals.filter((e) => e.evaluator === name).map((e) => e.playerId),
    );
    return { name, scored: scoredPlayerIds.size, total: tryout.roster.length };
  });
}
