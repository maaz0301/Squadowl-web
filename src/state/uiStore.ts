import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { zustandStorage } from '@/lib/storage';

interface OnboardingState {
  wizardCompleted: boolean;
  wizardSkipped: boolean;
  completeWizard: () => void;
  skipWizard: () => void;
  resetWizard: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      wizardCompleted: false,
      wizardSkipped: false,
      completeWizard: () => set({ wizardCompleted: true }),
      skipWizard: () => set({ wizardSkipped: true }),
      resetWizard: () => set({ wizardCompleted: false, wizardSkipped: false }),
    }),
    { name: 'aas-onboarding', storage: zustandStorage },
  ),
);

interface UIState {
  isRefreshing: boolean;
  globalError: string | null;
  setRefreshing: (v: boolean) => void;
  setGlobalError: (msg: string | null) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  isRefreshing: false,
  globalError: null,
  setRefreshing: (v) => set({ isRefreshing: v }),
  setGlobalError: (msg) => set({ globalError: msg }),
}));
