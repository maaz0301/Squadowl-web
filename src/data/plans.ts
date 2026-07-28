import type { PlanTier } from './types';

export interface PlanFeature {
  label: string;
  included: boolean;
}

export interface PlanDefinition {
  tier: PlanTier;
  name: string;
  price: string;
  priceNote?: string;
  highlight?: boolean;
  features: PlanFeature[];
  limits: {
    assessments: number | 'unlimited';
    players: number;
    teams: number;
    customRubrics: number | 'unlimited';
    teamBuilder: boolean;
    aiSummaries: boolean;
    exports: ('csv' | 'pdf' | 'xlsx')[];
    shareLinks: boolean;
    seasonHub: boolean;
    guardianPortal: boolean;
    enterprise: boolean;
    qrRegistration: boolean;
  };
}

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    tier: 'free',
    name: 'Free',
    price: 'CAD$0',
    priceNote: 'forever',
    features: [
      { label: '1 assessment', included: true },
      { label: '20 players', included: true },
      { label: 'QR registration', included: false },
      { label: 'Team Builder', included: false },
      { label: 'AI summaries', included: false },
    ],
    limits: {
      assessments: 1,
      players: 20,
      teams: 1,
      customRubrics: 0,
      teamBuilder: false,
      aiSummaries: false,
      exports: [],
      shareLinks: false,
      seasonHub: false,
      guardianPortal: false,
      enterprise: false,
      qrRegistration: false,
    },
  },
  {
    tier: 'coach',
    name: 'Coach',
    price: 'CAD$29.99',
    priceNote: '/year',
    highlight: true,
    features: [
      { label: 'Unlimited assessments', included: true },
      { label: '60 players', included: true },
      { label: 'QR registration & cloud sync', included: true },
      { label: 'CSV export', included: true },
      { label: 'Season Hub (basic)', included: true },
    ],
    limits: {
      assessments: 'unlimited',
      players: 60,
      teams: 1,
      customRubrics: 5,
      teamBuilder: false,
      aiSummaries: false,
      exports: ['csv'],
      shareLinks: false,
      seasonHub: true,
      guardianPortal: true,
      enterprise: false,
      qrRegistration: true,
    },
  },
  {
    tier: 'club',
    name: 'Club',
    price: 'CAD$59.99',
    priceNote: '/year',
    features: [
      { label: 'Team Builder (Sort Out)', included: true },
      { label: 'AI player & compare summaries', included: true },
      { label: 'PDF export & share links', included: true },
      { label: '3 teams', included: true },
      { label: 'Guardian portal emails', included: true },
    ],
    limits: {
      assessments: 'unlimited',
      players: 120,
      teams: 3,
      customRubrics: 'unlimited',
      teamBuilder: true,
      aiSummaries: true,
      exports: ['csv', 'pdf'],
      shareLinks: true,
      seasonHub: true,
      guardianPortal: true,
      enterprise: false,
      qrRegistration: true,
    },
  },
  {
    tier: 'pro',
    name: 'Pro',
    price: 'CAD$99.99',
    priceNote: '/year',
    features: [
      { label: '8 teams', included: true },
      { label: 'White-label PDF exports', included: true },
      { label: 'Bulk CSV import', included: true },
      { label: 'Priority support', included: true },
    ],
    limits: {
      assessments: 'unlimited',
      players: 300,
      teams: 8,
      customRubrics: 'unlimited',
      teamBuilder: true,
      aiSummaries: true,
      exports: ['csv', 'pdf', 'xlsx'],
      shareLinks: true,
      seasonHub: true,
      guardianPortal: true,
      enterprise: false,
      qrRegistration: true,
    },
  },
  {
    tier: 'association',
    name: 'Association',
    price: 'CAD$249.99',
    priceNote: '/year',
    features: [
      { label: '15 teams (+$15/add-on)', included: true },
      { label: 'Enterprise org dashboard', included: true },
      { label: 'Admin portal access', included: true },
      { label: 'Org-wide availability', included: true },
    ],
    limits: {
      assessments: 'unlimited',
      players: 1000,
      teams: 15,
      customRubrics: 'unlimited',
      teamBuilder: true,
      aiSummaries: true,
      exports: ['csv', 'pdf', 'xlsx'],
      shareLinks: true,
      seasonHub: true,
      guardianPortal: true,
      enterprise: true,
      qrRegistration: true,
    },
  },
];

export function getPlanDefinition(tier: PlanTier): PlanDefinition {
  return PLAN_DEFINITIONS.find((p) => p.tier === tier) ?? PLAN_DEFINITIONS[1];
}

export function canUseFeature(tier: PlanTier, feature: keyof PlanDefinition['limits']): boolean {
  const plan = getPlanDefinition(tier);
  const val = plan.limits[feature];
  if (typeof val === 'boolean') return val;
  if (Array.isArray(val)) return val.length > 0;
  if (val === 'unlimited') return true;
  return (val as number) > 0;
}

export function isAtAssessmentLimit(tier: PlanTier, count: number): boolean {
  const limit = getPlanDefinition(tier).limits.assessments;
  if (limit === 'unlimited') return false;
  return count >= limit;
}

export function isAtPlayerLimit(tier: PlanTier, count: number): boolean {
  return count >= getPlanDefinition(tier).limits.players;
}

export function isAtTeamLimit(tier: PlanTier, count: number): boolean {
  return count >= getPlanDefinition(tier).limits.teams;
}
