'use client';

import { Icon, type IconName } from '@/components/Icons';
import { useThemeColors } from '@/theme/ThemeProvider';

/** Small icon + uppercase label, with an optional "View All >" link. */
export function HubSectionLabel({
  icon,
  label,
  actionLabel,
  onAction,
}: {
  icon: IconName;
  label: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const colors = useThemeColors();
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2">
        <Icon name={icon} size={14} color={colors.primary} />
        <h2 className="text-xs font-bold tracking-wider uppercase" style={{ color: colors.inkMuted }}>
          {label}
        </h2>
      </div>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="flex items-center gap-1 text-xs font-medium hover:brightness-125"
          style={{ color: colors.inkMuted }}
        >
          {actionLabel}
          <Icon name="chevronRight" size={12} color={colors.inkMuted} strokeWidth={2.5} />
        </button>
      ) : null}
    </div>
  );
}
