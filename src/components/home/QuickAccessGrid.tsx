'use client';

import Link from 'next/link';

import { Card } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icons';
import { useThemeColors } from '@/theme/ThemeProvider';

export interface QuickAccessItem {
  key: string;
  label: string;
  caption: string;
  icon: IconName;
  /** Navigates. Exactly one of `href` / `onClick` is set. */
  href?: string;
  onClick?: () => void;
  /** The section this card jumps to is the one currently showing. */
  active?: boolean;
}

/**
 * Grid of hub shortcuts. Every card shares one treatment — orange is the only
 * accent (icon glyph on a tinted chip, active outline) and the cards differ by
 * icon and label, not by colour.
 */
export function QuickAccessGrid({ items }: { items: QuickAccessItem[] }) {
  const colors = useThemeColors();

  const body = (item: QuickAccessItem) => (
    <Card
      interactive
      className="flex h-full flex-col gap-2 p-3.5"
      style={item.active ? { borderColor: colors.primary, backgroundColor: 'rgba(255,107,43,0.09)' } : undefined}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg"
          style={{ backgroundColor: 'rgba(255,107,43,0.12)' }}
        >
          <Icon name={item.icon} size={17} color={colors.primary} />
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color: colors.ink }}>
          {item.label}
        </span>
        <Icon name="chevronRight" size={16} color={colors.inkMuted} strokeWidth={2.5} />
      </div>
      <p className="text-sm" style={{ color: colors.inkMuted }}>
        {item.caption}
      </p>
    </Card>
  );

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) =>
        item.href ? (
          <Link key={item.key} href={item.href} className="block h-full">
            {body(item)}
          </Link>
        ) : (
          <button
            key={item.key}
            type="button"
            onClick={item.onClick}
            className="block h-full w-full text-left"
            aria-pressed={item.active}
          >
            {body(item)}
          </button>
        ),
      )}
    </div>
  );
}
