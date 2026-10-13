'use client';

import { useMemo, useState } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { FUTURE_BIRTH_MESSAGE, MONTHS, buildDateOfBirth, daysInMonth, isFutureBirth, splitDateOfBirth, withYear } from '@/lib/birthDate';
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
 * The native picker, nothing drawn over it. An empty field shows whatever the
 * browser's own hint is ("mm/dd/yyyy" / "--:-- --" on Chrome, nothing at all on
 * iOS Safari) — these used to carry a "Select date"/"Select time" placeholder of
 * their own inside the box, which read as a second label under the field's real
 * one, so it was removed along with the globals.css rule that hid the native
 * hint to make room for it.
 */
function PickerInput({
  type,
  value,
  min,
  disabled,
  onChange,
  error,
}: {
  type: 'date' | 'time';
  value?: string;
  min?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  error?: string;
}) {
  const fieldStyle = useFieldStyle(error);

  return (
    <input
      type={type}
      value={value ?? ''}
      min={min}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={CONTROL}
      style={fieldStyle}
    />
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

interface BirthDateFieldProps {
  label?: string;
  /** The year of birth, "YYYY" — always kept, whether or not the full date is known. */
  year?: string;
  /** The full date, "YYYY-MM-DD", or '' while the month or day is not chosen. */
  dateOfBirth?: string;
  onChange: (value: { year: string; dateOfBirth: string }) => void;
  error?: string;
}

/**
 * Year, month and day of birth. The year alone is still a complete answer (the
 * month and day are optional); choosing all three records the full date.
 */
export function BirthDateField({ label, year = '', dateOfBirth = '', onChange, error: errorProp }: BirthDateFieldProps) {
  const error = errorProp || (isFutureBirth(year, dateOfBirth) ? FUTURE_BIRTH_MESSAGE : undefined);
  const fieldStyle = useFieldStyle(error);
  const parts = splitDateOfBirth(dateOfBirth);
  // A month and day picked before the date was complete live only here until
  // all three are set, so choosing them in any order does not lose the first.
  const [pending, setPending] = useState<{ month: string; day: string }>({ month: parts.month, day: parts.day });
  const month = parts.month || pending.month;
  const day = parts.day || pending.day;

  const years = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const list: number[] = [];
    for (let y = currentYear; y >= 1950; y--) list.push(y);
    return list;
  }, []);
  const dayCount = year && month ? daysInMonth(Number(year), Number(month)) : 31;

  const emit = (nextYear: string, nextMonth: string, nextDay: string) => {
    const fixed = withYear({ year, month: nextMonth, day: nextDay }, nextYear);
    setPending({ month: fixed.month, day: fixed.day });
    onChange({ year: nextYear, dateOfBirth: buildDateOfBirth(nextYear, fixed.month, fixed.day) });
  };

  const arrow =
    "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238fa3c8' stroke-width='2.5' stroke-linecap='round'><path d='M6 9l6 6 6-6'/></svg>\")";
  const selectStyle = {
    ...fieldStyle,
    backgroundImage: arrow,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 8px center',
    backgroundSize: '14px',
    // Inline so the tight padding always beats the shared control padding; the
    // three selects share a half-width column in the Add Player form and
    // "Year" / "Day" were being clipped to "Yea" / "D".
    paddingLeft: 10,
    paddingRight: 26,
    textOverflow: 'clip',
  } as const;
  const selectClass = `${CONTROL} min-w-0 cursor-pointer appearance-none`;

  return (
    <FieldShell label={label} error={error}>
      <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,1fr)] gap-1.5">
        <select
          aria-label="Year of birth"
          value={year}
          onChange={(e) => emit(e.target.value, month, day)}
          className={selectClass}
          style={selectStyle}
        >
          <option value="">Year</option>
          {years.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
        <select
          aria-label="Month of birth"
          value={month}
          onChange={(e) => emit(year, e.target.value, day)}
          className={selectClass}
          style={selectStyle}
        >
          <option value="">Month</option>
          {MONTHS.map((m, i) => (
            <option key={m} value={String(i + 1)}>
              {m}
            </option>
          ))}
        </select>
        <select
          aria-label="Day of birth"
          value={day}
          onChange={(e) => emit(year, month, e.target.value)}
          className={selectClass}
          style={selectStyle}
        >
          <option value="">Day</option>
          {Array.from({ length: dayCount }, (_, i) => (
            <option key={i + 1} value={String(i + 1)}>
              {i + 1}
            </option>
          ))}
        </select>
      </div>
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
