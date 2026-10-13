'use client';

import { useThemeColors } from '@/theme/ThemeProvider';
import { allNotAttempted, withAllNotAttempted, withoutAnyNotAttempted } from '@/lib/notAttempted';
import { useAlert } from './Alert';

/**
 * One line above a skater's tests for the case where they took none of them: marks every test
 * as not attempted (N/A on reports, out of the overall score). Undo takes the marks back off.
 */
export function NotAttemptedAll({
  keys,
  scores,
  onChange,
}: {
  keys: string[];
  scores: Record<string, number> | undefined;
  onChange: (next: Record<string, number>) => void;
}) {
  const colors = useThemeColors();
  const { confirm } = useAlert();
  if (!keys.length) return null;
  const all = allNotAttempted(scores, keys);
  const hasResults = keys.some((k) => scores?.[k] != null);

  const markAll = async () => {
    if (
      hasResults &&
      !(await confirm({
        title: 'Did not attempt anything?',
        message: 'The scores entered so far are cleared and every test is marked N/A.',
        confirmLabel: 'Mark all N/A',
        destructive: true,
      }))
    ) {
      return;
    }
    onChange(withAllNotAttempted(scores, keys));
  };

  return (
    <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: colors.border }}>
      {all ? (
        <>
          <span className="font-bold" style={{ color: colors.inkMuted }}>N/A: did not attempt any test</span>
          <button type="button" onClick={() => onChange(withoutAnyNotAttempted(scores, keys))} className="font-bold underline-offset-2 hover:underline" style={{ color: colors.primary }}>
            Undo
          </button>
        </>
      ) : (
        <>
          <span style={{ color: colors.inkMuted }}>Skater took none of these tests?</span>
          <button type="button" onClick={markAll} aria-label="Mark every test as not attempted" className="font-bold underline-offset-2 hover:underline" style={{ color: colors.primary }}>
            Did not attempt anything
          </button>
        </>
      )}
    </div>
  );
}
