import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { zustandStorage } from '@/lib/storage';
import { type Assessor } from '@/data/types';

export type RosterFilter = 'all' | 'scored' | 'unscored' | 'goalies' | 'skaters';

interface SessionState {
  currentTryoutId: string | null;
  currentPlayerId: string | null;
  currentEvalId: string | null;
  workingScores: Record<string, number>;
  rosterFilter: RosterFilter;
  rinksideIndex: number;
  activeAssessor: Assessor | null;
  combineTryoutIds: string[];
  completedSessions: Record<string, string[]>;
  setCurrentTryout: (id: string | null) => void;
  setCurrentPlayer: (id: string | null) => void;
  setCurrentEval: (id: string | null) => void;
  setWorkingScores: (scores: Record<string, number>) => void;
  updateWorkingScore: (key: string, value: number) => void;
  clearWorkingScores: () => void;
  setRosterFilter: (filter: RosterFilter) => void;
  setRinksideIndex: (index: number) => void;
  setActiveAssessor: (assessor: Assessor | null) => void;
  setCombineTryoutIds: (ids: string[]) => void;
  toggleCombineTryout: (id: string) => void;
  markSessionCompleted: (playerId: string, sessionName: string) => void;
  resetAssessmentSession: () => void;
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      currentTryoutId: null,
      currentPlayerId: null,
      currentEvalId: null,
      workingScores: {},
      rosterFilter: 'all',
      rinksideIndex: 0,
      activeAssessor: null,
      combineTryoutIds: [],
      completedSessions: {},
      setCurrentTryout: (id) => set({ currentTryoutId: id }),
      setCurrentPlayer: (id) => set({ currentPlayerId: id }),
      setCurrentEval: (id) => set({ currentEvalId: id }),
      setWorkingScores: (scores) => set({ workingScores: scores }),
      updateWorkingScore: (key, value) =>
        set((s) => ({ workingScores: { ...s.workingScores, [key]: value } })),
      clearWorkingScores: () => set({ workingScores: {}, currentEvalId: null }),
      setRosterFilter: (filter) => set({ rosterFilter: filter }),
      setRinksideIndex: (index) => set({ rinksideIndex: index }),
      setActiveAssessor: (assessor) => set({ activeAssessor: assessor }),
      setCombineTryoutIds: (ids: string[]) => set({ combineTryoutIds: ids }),
      toggleCombineTryout: (id: string) =>
        set((s) => ({
          combineTryoutIds: s.combineTryoutIds.includes(id)
            ? s.combineTryoutIds.filter((x) => x !== id)
            : [...s.combineTryoutIds, id],
        })),
      markSessionCompleted: (playerId: string, sessionName: string) =>
        set((s) => {
          const current = s.completedSessions[playerId] || [];
          if (current.includes(sessionName)) return {};
          return {
            completedSessions: {
              ...s.completedSessions,
              [playerId]: [...current, sessionName],
            },
          };
        }),
      resetAssessmentSession: () =>
        set({
          currentPlayerId: null,
          currentEvalId: null,
          workingScores: {},
          rinksideIndex: 0,
          completedSessions: {},
        }),
    }),
    {
      name: 'aas-session',
      storage: zustandStorage,
      partialize: (s) => ({
        currentTryoutId: s.currentTryoutId,
        rosterFilter: s.rosterFilter,
        completedSessions: s.completedSessions,
      }),
    },
  ),
);
