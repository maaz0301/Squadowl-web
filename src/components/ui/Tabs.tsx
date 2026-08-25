'use client';

import { cn } from '@/lib/cn';
import { useThemeColors } from '@/theme/ThemeProvider';

export interface TabItem {
  key: string;
  label: string;
  badge?: number;
}

interface TabsProps {
  tabs: TabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  className?: string;
}

export function Tabs({ tabs, activeKey, onChange, className }: TabsProps) {
  const colors = useThemeColors();
  return (
    <div className={cn('no-scrollbar flex snap-x snap-proximity gap-1.5 overflow-x-auto py-1', className)}>
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className="inline-flex min-h-[44px] shrink-0 snap-start items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors active:scale-[0.97]"
            style={{
              backgroundColor: active ? colors.primary : colors.tile,
              color: active ? '#fff' : colors.inkMuted,
            }}
          >
            {tab.label}
            {tab.badge != null && tab.badge > 0 ? (
              <span
                className="inline-flex min-w-[20px] justify-center rounded-full px-1.5 py-0.5 text-xs font-bold text-white"
                style={{ backgroundColor: active ? 'rgba(255,255,255,0.25)' : colors.primary }}
              >
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
