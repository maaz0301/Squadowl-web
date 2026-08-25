'use client';

import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';
import { useThemeColors } from '@/theme/ThemeProvider';

export function FieldShell({
  label,
  error,
  hint,
  htmlFor,
  className,
  children,
}: {
  label?: string;
  error?: string;
  hint?: string;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label ? (
        <label
          htmlFor={htmlFor}
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: colors.inkMuted }}
        >
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="text-sm" style={{ color: colors.danger }}>
          {error}
        </span>
      ) : hint ? (
        <span className="text-xs" style={{ color: colors.inkFaint }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function useFieldStyle(error?: string) {
  const colors = useThemeColors();
  return {
    backgroundColor: colors.field,
    borderColor: error ? colors.danger : colors.border,
    color: colors.ink,
  } as const;
}

// text-base (16px) on phones, 15px from sm up. Anything under 16px makes iOS
// Safari zoom the page in on focus and never zoom back out; the Tailwind class
// outranks the global input rule, so the breakpoint has to live here.
const CONTROL_CLASS =
  'w-full rounded-xl border px-4 py-3 text-base sm:text-[15px] min-h-[48px] outline-none transition-colors focus:border-[color:var(--c-primary)]';

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: string;
  error?: string;
  hint?: string;
  isPassword?: boolean;
  rightAccessory?: ReactNode;
  containerClassName?: string;
}

function EyeIcon({ visible, color }: { visible: boolean; color: string }) {
  return (
    <svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      {visible ? (
        <>
          <path
            d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={12} cy={12} r={3} stroke={color} strokeWidth={2} />
        </>
      ) : (
        <path
          d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24M1 1l22 22"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

export function Input({
  label,
  error,
  hint,
  isPassword,
  rightAccessory,
  containerClassName,
  className,
  style,
  type,
  id,
  ...props
}: InputProps) {
  const colors = useThemeColors();
  const [show, setShow] = useState(false);
  const autoId = useId();
  const inputId = id ?? autoId;
  const fieldStyle = useFieldStyle(error);

  return (
    <FieldShell label={label} error={error} hint={hint} htmlFor={inputId} className={containerClassName}>
      <div className="relative flex items-center">
        <input
          id={inputId}
          type={isPassword ? (show ? 'text' : 'password') : type}
          className={cn(CONTROL_CLASS, (isPassword || rightAccessory) && 'pr-12', className)}
          style={{ ...fieldStyle, ...style }}
          {...props}
        />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setShow((v) => !v)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-1 flex h-11 w-11 items-center justify-center rounded-lg"
          >
            <EyeIcon visible={show} color={colors.inkMuted} />
          </button>
        ) : rightAccessory ? (
          <div className="absolute right-3 flex items-center">{rightAccessory}</div>
        ) : null}
      </div>
    </FieldShell>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  hint?: string;
  containerClassName?: string;
}

export function Textarea({
  label,
  error,
  hint,
  containerClassName,
  className,
  style,
  rows = 4,
  id,
  ...props
}: TextareaProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const fieldStyle = useFieldStyle(error);
  return (
    <FieldShell label={label} error={error} hint={hint} htmlFor={fieldId} className={containerClassName}>
      <textarea
        id={fieldId}
        rows={rows}
        className={cn(CONTROL_CLASS, 'resize-y leading-relaxed', className)}
        style={{ ...fieldStyle, ...style }}
        {...props}
      />
    </FieldShell>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  hint?: string;
  options?: { value: string; label: string; disabled?: boolean }[];
  containerClassName?: string;
}

export function Select({
  label,
  error,
  hint,
  options,
  children,
  containerClassName,
  className,
  style,
  id,
  ...props
}: SelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const fieldStyle = useFieldStyle(error);
  return (
    <FieldShell label={label} error={error} hint={hint} htmlFor={fieldId} className={containerClassName}>
      <select
        id={fieldId}
        className={cn(CONTROL_CLASS, 'appearance-none pr-10 cursor-pointer', className)}
        style={{
          ...fieldStyle,
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238fa3c8' stroke-width='2.5' stroke-linecap='round'><path d='M6 9l6 6 6-6'/></svg>\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 12px center',
          backgroundSize: '16px',
          ...style,
        }}
        {...props}
      >
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
          : children}
      </select>
    </FieldShell>
  );
}

/** Checkbox styled to the theme, used for the app's toggle rows. */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <label
      className={cn(
        'flex min-h-[44px] items-center gap-2.5 cursor-pointer select-none',
        disabled && 'opacity-50 pointer-events-none',
      )}
    >
      <span
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border text-[12px] font-bold text-white transition-colors"
        style={{
          borderColor: checked ? colors.primary : colors.border,
          backgroundColor: checked ? colors.primary : 'transparent',
        }}
      >
        {checked ? '✓' : ''}
      </span>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-[15px]" style={{ color: colors.ink }}>
        {label}
      </span>
    </label>
  );
}

/** Sliding on/off switch. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <label
      className={cn(
        'flex min-h-[44px] items-center gap-3 cursor-pointer select-none',
        disabled && 'opacity-50 pointer-events-none',
      )}
    >
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        // The track is only 24px tall; the padding lifts the tap target to 44px
        // and the matching negative margin keeps the row laid out as before.
        className="-my-2.5 shrink-0 py-2.5"
      >
        <span
          className="relative block h-6 w-11 rounded-full border transition-colors"
          style={{
            backgroundColor: checked ? colors.primary : colors.tile,
            borderColor: checked ? colors.primary : colors.border,
          }}
        >
          <span
            className="absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white transition-[left]"
            style={{ left: checked ? 22 : 2 }}
          />
        </span>
      </button>
      {label ? (
        <span className="text-[15px]" style={{ color: colors.ink }}>
          {label}
        </span>
      ) : null}
    </label>
  );
}
