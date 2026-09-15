import { useEffect, useRef, useState, type ReactNode } from 'react';

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

export function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div className="toast" role="status" aria-live="polite">
      <div className="spread">
        <span className="grow">{message}</span>
        <button type="button" className="btn btn-quiet btn-sm" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
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

/** Amounts can be blurred until tapped, for days when seeing the number is too much. */
export function Amount({ text, blur }: { text: string; blur: boolean }) {
  const [revealed, setRevealed] = useState(false);
  if (!blur || revealed) return <span className="amount">{text}</span>;
  return (
    <button
      type="button"
      className="amount blurred"
      style={{ background: 'none', border: 'none', font: 'inherit', color: 'inherit', padding: 0 }}
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
