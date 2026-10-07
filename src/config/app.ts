export const APP_CONFIG = {
  appName: 'SquadOwl',
  appVersion: '1.0.0',
  /** Supabase — provided via NEXT_PUBLIC_* env vars (see .env.example) */
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  webUrl: process.env.NEXT_PUBLIC_WEB_URL ?? '',
} as const;
