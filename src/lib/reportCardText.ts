import type { AiPlayerSummary } from '@/data/types';

/** Turns the AI's structured summary into plain text a coach can edit before it goes on a report card. */
export function formatAiComments(s: AiPlayerSummary): string {
  const parts: string[] = [];
  if (s.summary?.trim()) parts.push(s.summary.trim());
  if (s.key_strengths?.length) parts.push(`Strengths:\n${s.key_strengths.map((x) => `- ${x}`).join('\n')}`);
  if (s.key_growth?.length) parts.push(`To work on:\n${s.key_growth.map((x) => `- ${x}`).join('\n')}`);
  if (s.role_fit?.trim()) parts.push(`Role fit: ${s.role_fit.trim()}`);
  return parts.join('\n\n');
}
