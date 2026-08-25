'use client';

import { useMemo } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { FieldShell, useFieldStyle } from './Input';
import { COUNTRY_CODES } from './countryCodes';

// Longest prefix wins so +242 doesn't get read as +2. Sorted once at module
// load rather than per-render/per-keystroke — the list itself never changes,
// only which entry in it matches a given value.
const COUNTRY_CODES_BY_LENGTH = [...COUNTRY_CODES].sort((a, b) => b.code.length - a.code.length);

// text-base (16px) on phones, 15px from sm up. Anything under 16px makes iOS
// Safari zoom the page in on focus and never zoom back out; the Tailwind class
// outranks the global input rule, so the breakpoint has to live here.
const CONTROL =
  'w-full rounded-xl border px-4 py-3 text-base sm:text-[15px] min-h-[48px] outline-none transition-colors focus:border-[color:var(--c-primary)]';

const pad = (n: number) => String(n).padStart(2, '0');
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * The native picker plus a placeholder of our own. An empty date or time input
 * paints nothing at all on iOS Safari — there is no "mm/dd/yyyy" hint like the
 * one Chrome gives Android — so on iPhone these read as blank boxes under their
 * labels. globals.css hides the browser's own hint while the field is empty and
 * unfocused, leaving this the only placeholder on either platform; focusing
 * brings the native segments back for keyboard entry.
 */
function PickerInput({
  type,
  placeholder,
  value,
  min,
  disabled,
  onChange,
  error,
}: {
  type: 'date' | 'time';
  placeholder: string;
  value?: string;
  min?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  error?: string;
}) {
  const colors = useThemeColors();
  const fieldStyle = useFieldStyle(error);
  const isEmpty = !value;

  return (
    <div className="relative">
      <input
        type={type}
        value={value ?? ''}
        min={min}
        disabled={disabled}
        data-empty={isEmpty ? '' : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={`${CONTROL} peer`}
        style={fieldStyle}
      />
      {isEmpty ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-base peer-focus:hidden sm:text-[15px]"
          style={{ color: colors.placeholder }}
        >
          {placeholder}
        </span>
      ) : null}
    </div>
  );
}

interface DateFieldProps {
  label?: string;
  value?: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  error?: string;
  disablePast?: boolean;
  /** Earliest selectable date (YYYY-MM-DD), e.g. an event's start date for its end date field. */
  minDate?: string;
  disabled?: boolean;
}

/** Native date picker — same YYYY-MM-DD contract as the app's calendar sheet. */
export function DateField({ label, value, onChange, error, disablePast, minDate, disabled }: DateFieldProps) {
  const min = minDate ?? (disablePast ? todayKey() : undefined);
  return (
    <FieldShell label={label} error={error}>
      <PickerInput
        type="date"
        placeholder="Select date"
        value={value}
        min={min}
        disabled={disabled}
        onChange={onChange}
        error={error}
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
  // Only clamp when the chosen date is today; a future date allows any time.
  const min = useMemo(() => {
    if (!disablePast) return undefined;
    if (dateValue && dateValue !== todayKey()) return undefined;
    const now = new Date();
    return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }, [disablePast, dateValue]);

  return (
    <FieldShell label={label} error={error}>
      <PickerInput
        type="time"
        placeholder="Select time"
        value={value}
        min={min}
        disabled={disabled}
        onChange={onChange}
        error={error}
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

  const matched = COUNTRY_CODES_BY_LENGTH.find((c) => value.startsWith(c.code));
  const parsed = matched
    ? { code: matched.code, number: value.substring(matched.code.length).trim() }
    : { code: '+1', number: value };

  const handleNumberChange = (num: string) => {
    // Cap at 15 digits (ignoring formatting) — matches the 10–15 validation rule.
    if (num.replace(/\D/g, '').length > 15) return;
    onChange(`${parsed.code} ${num}`);
  };

  return (
    <FieldShell label={label} error={error}>
      <div className="flex gap-2">
        {/* A native select paints the selected option's full text, and
            "+1 · United States" has never fitted the narrow control — it was
            clipped mid-word and collided with the browser's own arrow. The
            select keeps every country name for the picker (native wheel on
            iOS, native list on Android) but renders its own text transparent;
            the span below draws just the dial code, which is all the closed
            state needs to show. Options get an explicit colour because some
            browsers inherit the transparent one into the open list. */}
        <div className="relative shrink-0">
          <select
            value={parsed.code}
            onChange={(e) => onChange(`${e.target.value} ${parsed.number}`)}
            className="min-h-[48px] w-[92px] cursor-pointer appearance-none rounded-xl border pl-3 pr-7 text-base outline-none focus:border-[color:var(--c-primary)] sm:text-[15px]"
            style={{ ...fieldStyle, color: 'transparent' }}
            aria-label="Country code"
          >
            {COUNTRY_CODES.map((c) => (
              <option key={c.name} value={c.code} style={{ color: colors.ink, backgroundColor: colors.field }}>
                {c.code} · {c.name.replace(/\s*\(\+\d+\)$/, '')}
              </option>
            ))}
          </select>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base font-semibold sm:text-[15px]"
            style={{ color: colors.ink }}
          >
            {parsed.code}
          </span>
          <svg
            aria-hidden
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2"
            width={14}
            height={14}
            viewBox="0 0 24 24"
            fill="none"
          >
            <path d="M6 9l6 6 6-6" stroke={colors.inkMuted} strokeWidth={2.5} strokeLinecap="round" />
          </svg>
        </div>
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
