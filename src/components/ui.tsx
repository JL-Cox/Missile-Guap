import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DateKey, Note } from '../types';
import { addDays } from '../lib/time';

/** Small shared pieces. Everything is labelled in words - no icon-only controls. */

export function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="stack" aria-label={title}>
      <div className="section-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * Empty states never say "you have nothing" or show a sad face. They say what
 * this space is for, so an empty screen reads as ready rather than as failure.
 */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/* ---------------------------------------------------------------------------
   Feedback after an action

   Anything that makes a thing move or disappear says where it went, in a toast,
   and - where it can be taken back - offers Undo right there. Views reach the
   toast through this context rather than a prop threaded through every screen.
   -------------------------------------------------------------------------- */

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastState {
  /** Bumped on every call, so the same words twice still restart the timer. */
  id: number;
  message: string;
  action?: ToastAction;
}

export type ShowToast = (message: string, action?: ToastAction) => void;

export const ToastContext = createContext<ShowToast>(() => undefined);

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

/**
 * How long a toast stays. Longer with an Undo on it, because reading "Deleted."
 * and deciding you did not mean it takes longer than reading "Saved." - and the
 * timer stops altogether while a finger or the keyboard is on the toast.
 */
export const TOAST_MS = 5000;
export const TOAST_WITH_ACTION_MS = 10000;

export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(onDismiss, toast.action ? TOAST_WITH_ACTION_MS : TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.action, held, onDismiss]);

  return (
    <div
      className="toast"
      role="status"
      aria-live="polite"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="spread">
        <span className="grow">{toast.message}</span>
        <span className="toast-actions">
          {toast.action && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                // Dismissed first: the action often shows a toast of its own.
                const { run } = toast.action!;
                onDismiss();
                void run();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="btn btn-quiet btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   The Back button

   On Android, Back used to leave the app from anywhere, because nothing in it
   ever made a history entry. A view with something open on top of it - an
   editor, a confirmation - declares it here, and App turns that into a history
   entry, so Back closes the editor rather than the app. See App.tsx.
   -------------------------------------------------------------------------- */

export const LayerContext = createContext<(close: (() => void) | null) => void>(() => undefined);

/** While `open`, the Back button calls `close` instead of leaving the screen. */
export function useBackLayer(open: boolean, close: () => void): void {
  const register = useContext(LayerContext);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    register(() => closeRef.current());
    return () => register(null);
  }, [open, register]);
}

/* ---------------------------------------------------------------------------
   Moving between screens from inside one
   -------------------------------------------------------------------------- */

/**
 * `query` opens Tasks with a search already in the box; `note` opens Notes with
 * that note in the editor, which is how a task row gets you to the note it
 * points at.
 */
export type Navigate = (view: 'tasks' | 'notes', options?: { query?: string; note?: Note }) => void;
export const NavigateContext = createContext<Navigate>(() => undefined);
export function useNavigate(): Navigate {
  return useContext(NavigateContext);
}

/**
 * A form's "that didn't work" message. It sits directly above the Save row,
 * where your eyes already are when you press Save, and is scrolled into view
 * and announced - partway up a long form it was easy to press Save, see
 * nothing happen, and not know why. A notice, not an alarm: no red.
 */
export function FormError({ message }: { message: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [message]);
  if (!message) return null;
  return (
    <p ref={ref} className="notice" role="alert">
      {message}
    </p>
  );
}

/**
 * Today / Tomorrow / In a week, as buttons, so the three most common days are
 * one tap rather than a trip through the phone's date picker. Shared by the
 * task and subscription editors so they read the same.
 */
export function DateShortcuts({
  value,
  today,
  onPick,
  label,
  noneLabel,
}: {
  value: DateKey | undefined;
  today: DateKey;
  onPick: (date: DateKey | undefined) => void;
  label: string;
  /** Offer "no day" as a choice too, for fields where that is a real answer. */
  noneLabel?: string;
}) {
  const choices: [string, DateKey][] = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['In a week', addDays(today, 7)],
  ];
  return (
    <div className="btn-row" role="group" aria-label={label}>
      {choices.map(([text, date]) => (
        <button
          key={text}
          type="button"
          aria-pressed={value === date}
          className={`btn btn-sm${value === date ? ' btn-primary' : ''}`}
          onClick={() => onPick(date)}
        >
          {text}
        </button>
      ))}
      {noneLabel && (
        <button
          type="button"
          aria-pressed={!value}
          className={`btn btn-sm${!value ? ' btn-primary' : ''}`}
          onClick={() => onPick(undefined)}
        >
          {noneLabel}
        </button>
      )}
    </div>
  );
}

/**
 * The visible way into a row's details. Tapping the title still works, but a
 * title that opens something is a thing you have to know; this says it.
 */
export function DetailsButton({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls?: string }) {
  return (
    <button
      type="button"
      className="btn btn-quiet btn-sm details-btn"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      {open ? 'Details \u25be' : 'Details \u25b8'}
    </button>
  );
}

/** A stable callback that always calls the latest version of `fn`. */
export function useLatest<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

/**
 * Destructive actions ask twice, in place, with the real consequence spelled
 * out. No modal that steals focus and no dialog you can dismiss by accident.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = 'btn btn-sm',
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 6000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button type="button" className={className} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="row-tight">
      <button type="button" className="btn btn-sm btn-primary" onClick={() => { setArmed(false); onConfirm(); }}>
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-quiet btn-sm" onClick={() => setArmed(false)}>
        Keep it
      </button>
    </span>
  );
}

/**
 * Amounts can be blurred until tapped, for days when seeing the number is too
 * much. `className` adds a role, such as `amount-key` for a screen's anchor.
 */
export function Amount({ text, blur, className }: { text: string; blur: boolean; className?: string }) {
  const [revealed, setRevealed] = useState(false);
  const classes = `amount${className ? ` ${className}` : ''}`;
  if (!blur || revealed) return <span className={classes}>{text}</span>;
  return (
    <button
      type="button"
      className={`${classes} amount-btn blurred`}
      onClick={() => setRevealed(true)}
      aria-label="Amount hidden. Activate to show."
    >
      {text}
    </button>
  );
}

/** Focuses its child textarea/input on mount - used when opening an editor. */
export function useAutoFocus<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active]);
  return ref;
}

export function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="row-tight">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
    </span>
  );
}

export function parseTags(input: string): string[] {
  return [...new Set(input.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
