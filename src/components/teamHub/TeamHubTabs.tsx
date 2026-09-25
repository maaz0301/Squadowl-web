'use client';

import { Icon, type IconName } from '@/components/Icons';
import { useThemeColors } from '@/theme/ThemeProvider';
import { useHubSurfaces } from './hubTheme';

export interface HubTab {
  key: string;
  label: string;
  icon: IconName;
  badge?: number;
}

/**
 * Equal-width pill row under the hub header. The active pill is the solid
 * orange one; the others are panel-coloured with an orange count dot.
 */
export function TeamHubTabs({
  tabs,
  activeKey,
  onChange,
}: {
  tabs: HubTab[];
  activeKey: string;
  onChange: (key: string) => void;
}) {
  const colors = useThemeColors();
  const s = useHubSurfaces();

  return (
    // Two by two on a phone so four labels never get clipped; one row from sm up.
    <div role="tablist" className="mb-6 grid grid-cols-2 gap-2 sm:flex">
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        const ink = active ? '#ffffff' : colors.inkMuted;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tab.key)}
            className="flex h-11 min-w-0 items-center sm:flex-1 justify-center gap-1.5 rounded-xl border px-2 text-xs font-bold transition-colors active:scale-[0.98] sm:text-sm"
            style={{
              backgroundColor: active ? colors.primary : s.panelBg,
              borderColor: active ? colors.primary : s.panelBorder,
              color: ink,
            }}
          >
            <span className="shrink-0">
              <Icon name={tab.icon} size={15} color={ink} />
            </span>
            <span className="truncate">{tab.label}</span>
            {tab.badge != null && tab.badge > 0 ? (
              <span
                className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
                style={{ backgroundColor: active ? 'rgba(255,255,255,0.28)' : colors.primary }}
              >
                {tab.badge > 99 ? '99+' : tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
