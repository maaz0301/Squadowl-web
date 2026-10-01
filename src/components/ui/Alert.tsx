'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useThemeColors } from '@/theme/ThemeProvider';
import { VIEW_AS_READ_ONLY_MESSAGE, getImpersonationTarget } from '@/state/impersonationStore';
import { Button } from './Button';
import { Input } from './Input';
import { Modal, ModalFooter } from './Modal';

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /**
   * Every confirm() in the app fronts a write except the founder's own View as
   * Org / View as User buttons, which switch what's *displayed* — set this on
   * those so entering one "view as" from inside another isn't mistaken for an
   * edit and blocked by the read-only guard below.
   */
  allowWhileViewingAs?: boolean;
  /**
   * When set, the confirm button stays disabled until the user types this word
   * exactly as written (case-sensitive), for deletes that can't be undone.
   */
  requireText?: string;
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
  const [typed, setTyped] = useState('');

  const close = useCallback(
    (value: boolean) => {
      setTyped('');
      setDialog((d) => {
        d?.resolve(value);
        return null;
      });
    },
    [],
  );

  const api = useMemo<AlertApi>(
    () => ({
      alert: (title, message) => {
        // A write with no confirm() step in front of it (a plain Save button,
        // say) reaches here instead of the confirm() gate above: the caller
        // wraps the wrong-account error from writableAccountId() / the query
        // client's onMutate guard in its own "X failed: <message>" wording,
        // which reads like a bug rather than the read-only restriction it is.
        // VIEW_AS_READ_ONLY_MESSAGE is a fixed, purpose-built sentence — a
        // plain substring match is enough to recognize it inside any of those
        // wrappers and swap in the same clear notice confirm() shows.
        const readOnly = message?.includes(VIEW_AS_READ_ONLY_MESSAGE);
        return new Promise<void>((resolve) => {
          setDialog({
            mode: 'alert',
            title: readOnly ? 'Read-Only' : title,
            message: readOnly ? VIEW_AS_READ_ONLY_MESSAGE : message,
            resolve: () => resolve(),
          });
        });
      },
      confirm: (options) => {
        // Blocked here, before the caller's own confirm dialog ever paints,
        // rather than after the mutation fails silently underneath it — the
        // query client's onMutate guard and writableAccountId() both already
        // refuse the write itself, but neither one is in a position to tell
        // the founder why nothing happened.
        if (getImpersonationTarget() && !options.allowWhileViewingAs) {
          return new Promise<boolean>((resolve) => {
            setDialog({
              mode: 'alert',
              title: `Can't ${options.title}`,
              message: VIEW_AS_READ_ONLY_MESSAGE,
              resolve: () => resolve(false),
            });
          });
        }
        return new Promise<boolean>((resolve) => {
          setDialog({ mode: 'confirm', ...options, resolve });
        });
      },
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
              disabled={!!dialog?.requireText && typed.trim() !== dialog.requireText}
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
        {dialog?.requireText ? (
          <div className="mt-4">
            <Input
              label={`Type "${dialog.requireText}" to confirm`}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="none"
              autoFocus
            />
          </div>
        ) : null}
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
