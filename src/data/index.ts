import type { DataSource } from './datasource';
import { supabaseDataSource } from './supabase/SupabaseDataSource';

let instance: DataSource | null = null;

export function getDataSource(): DataSource {
  if (!instance) {
    instance = supabaseDataSource;
  }
  return instance!;
}

export { supabaseDataSource };
