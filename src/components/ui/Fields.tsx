'use client';

import { useMemo } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { FieldShell, useFieldStyle } from './Input';
import { COUNTRY_CODES } from './countryCodes';

const CONTROL =
  'w-full rounded-xl border px-4 py-3 text-[15px] min-h-[48px] outline-none transition-colors focus:border-[color:var(--c-primary)]';

const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

interface DateFieldProps {
  label?: string;
  value?: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  error?: string;
  disablePast?: boolean;
  disabled?: boolean;
}

/** Native date picker — same YYYY-MM-DD contract as the app's calendar sheet. */
export function DateField({ label, value, onChange, error, disablePast, disabled }: DateFieldProps) {
  const fieldStyle = useFieldStyle(error);
  return (
    <FieldShell label={label} error={error}>
      <input
        type="date"
        value={value ?? ''}
        min={disablePast ? todayKey() : undefined}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={CONTROL}
        style={fieldStyle}
      />
    </FieldShell>
  );
}

interface TimeFieldProps {
  label?: string;
  value?: string; // 24h HH:MM
  onChange: (value: string) => void;
  error?: string;
  disablePast?: boolean;
  dateValue?: string;
  disabled?: boolean;
}

/** Native time picker — stores 24h "HH:MM" exactly like the app's clock sheet. */
export function TimeField({ label, value, onChange, error, disablePast, dateValue, disabled }: TimeFieldProps) {
  const fieldStyle = useFieldStyle(error);

  // Only clamp when the chosen date is today; a future date allows any time.
  const min = useMemo(() => {
    if (!disablePast) return undefined;
    if (dateValue && dateValue !== todayKey()) return undefined;
    const now = new Date();
    return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }, [disablePast, dateValue]);

  return (
    <FieldShell label={label} error={error}>
      <input
        type="time"
        value={value ?? ''}
        min={min}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={CONTROL}
        style={fieldStyle}
      />
    </FieldShell>
  );
}

interface YearFieldProps {
  label?: string;
  value?: string; // YYYY
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
}

export function YearField({ label, value, onChange, placeholder = 'Select year', error }: YearFieldProps) {
  const fieldStyle = useFieldStyle(error);
  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const list: number[] = [];
    for (let y = currentYear; y >= 1950; y--) list.push(y);
    return list;
  }, []);

  return (
    <FieldShell label={label} error={error}>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className={`${CONTROL} cursor-pointer appearance-none pr-10`}
        style={{
          ...fieldStyle,
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238fa3c8' stroke-width='2.5' stroke-linecap='round'><path d='M6 9l6 6 6-6'/></svg>\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 12px center',
          backgroundSize: '16px',
        }}
      >
        <option value="">{placeholder}</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

interface PhoneFieldProps {
  label?: string;
  value?: string; // "+1 1234567890"
  onChange: (value: string) => void;
  error?: string;
  placeholder?: string;
}

export function PhoneField({ label, value = '', onChange, error, placeholder = 'Phone number' }: PhoneFieldProps) {
  const colors = useThemeColors();
  const fieldStyle = useFieldStyle(error);

  // Longest prefix wins so +242 doesn't get read as +2.
  const parsed = useMemo(() => {
    const sorted = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);
    const matched = sorted.find((c) => value.startsWith(c.code));
    if (matched) return { code: matched.code, number: value.substring(matched.code.length).trim() };
    return { code: '+1', number: value };
  }, [value]);

  const handleNumberChange = (num: string) => {
    // Cap at 15 digits (ignoring formatting) — matches the 10–15 validation rule.
    if (num.replace(/\D/g, '').length > 15) return;
    onChange(`${parsed.code} ${num}`);
  };

  return (
    <FieldShell label={label} error={error}>
      <div className="flex gap-2">
        <select
          value={parsed.code}
          onChange={(e) => onChange(`${e.target.value} ${parsed.number}`)}
          className="min-h-[48px] w-[110px] shrink-0 cursor-pointer rounded-xl border px-3 text-[15px] outline-none focus:border-[color:var(--c-primary)]"
          style={fieldStyle}
          aria-label="Country code"
        >
          {COUNTRY_CODES.map((c) => (
            <option key={c.name} value={c.code}>
              {c.code} · {c.name.replace(/\s*\(\+\d+\)$/, '')}
            </option>
          ))}
        </select>
        <input
          type="tel"
          placeholder={placeholder}
          value={parsed.number}
          onChange={(e) => handleNumberChange(e.target.value)}
          className={CONTROL}
          style={{ ...fieldStyle, color: colors.ink }}
        />
      </div>
    </FieldShell>
  );
}
