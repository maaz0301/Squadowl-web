'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { Button } from './Button';
import { Modal, ModalFooter } from './Modal';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface AlertApi {
  /** Replaces the app's Alert.alert(title, message) — informational, one button. */
  alert: (title: string, message?: string) => Promise<void>;
  /** Replaces Alert.alert with cancel/confirm buttons; resolves true when confirmed. */
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Transient bottom-right toast for success/feedback messages. */
  toast: (message: string, tone?: 'default' | 'success' | 'danger') => void;
}

const AlertContext = createContext<AlertApi | null>(null);

interface DialogState extends ConfirmOptions {
  mode: 'alert' | 'confirm';
  resolve: (value: boolean) => void;
}

interface ToastState {
  id: number;
  message: string;
  tone: 'default' | 'success' | 'danger';
}

export function AlertProvider({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const close = useCallback(
    (value: boolean) => {
      setDialog((d) => {
        d?.resolve(value);
        return null;
      });
    },
    [],
  );

  const api = useMemo<AlertApi>(
    () => ({
      alert: (title, message) =>
        new Promise<void>((resolve) => {
          setDialog({ mode: 'alert', title, message, resolve: () => resolve() });
        }),
      confirm: (options) =>
        new Promise<boolean>((resolve) => {
          setDialog({ mode: 'confirm', ...options, resolve });
        }),
      toast: (message, tone = 'default') => {
        const id = Math.random();
        setToasts((t) => [...t, { id, message, tone }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
      },
    }),
    [],
  );

  return (
    <AlertContext.Provider value={api}>
      {children}

      <Modal
        visible={!!dialog}
        title={dialog?.title ?? ''}
        size="sm"
        onClose={() => close(false)}
        footer={
          <ModalFooter>
            {dialog?.mode === 'confirm' ? (
              <Button label={dialog.cancelLabel ?? 'Cancel'} variant="ghost" onClick={() => close(false)} />
            ) : null}
            <Button
              label={dialog?.mode === 'confirm' ? (dialog.confirmLabel ?? 'Confirm') : 'OK'}
              variant={dialog?.destructive ? 'danger' : 'primary'}
              onClick={() => close(true)}
            />
          </ModalFooter>
        }
      >
        {/* whitespace-pre-wrap: callers throughout the app join multi-point
            messages with '\n\n' (see planChange.ts, roster/letters delete
            confirmations, ...) expecting paragraph breaks — a plain <p>
            collapses those, so every one of them rendered as a single
            run-on wall of text. */}
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed" style={{ color: colors.inkMuted }}>
          {dialog?.message}
        </p>
      </Modal>

      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto max-w-sm rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg"
            style={{
              backgroundColor: colors.card,
              borderColor:
                t.tone === 'success' ? colors.success : t.tone === 'danger' ? colors.danger : colors.border,
              color: t.tone === 'success' ? colors.success : t.tone === 'danger' ? colors.danger : colors.ink,
              animation: 'aas-rise 0.2s ease-out',
            }}
          >
            {t.message}
          </div>
        ))}
      </div>
    </AlertContext.Provider>
  );
}

export function useAlert(): AlertApi {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useAlert must be used within AlertProvider');
  return ctx;
}
