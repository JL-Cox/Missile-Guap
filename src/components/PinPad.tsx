import { useEffect } from 'react';
import { PIN_MAX, PIN_MIN } from '../lib/lock';
import { useLatest } from './ui';

const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * A number pad for the app lock: big keys, each one labelled, always in the
 * same place. The same pad is used to choose a PIN and to unlock, so the pad
 * you meet on the lock screen is the one you have already used once.
 *
 * Buttons rather than a text box, on purpose. A password box invites Chrome to
 * offer to save the PIN - to a Google account, which syncs. A plain text box
 * hands every digit to the keyboard app, which may learn it. A button press
 * goes nowhere but here. A physical keyboard still works: digits, Backspace
 * and Enter.
 *
 * Only a dot per digit is ever shown, never the digits themselves.
 */
export default function PinPad({
  value,
  onChange,
  onSubmit,
  submitLabel,
  disabled = false,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  submitLabel: string;
  disabled?: boolean;
  /** What the pad is for, for screen readers: "PIN", "New PIN". */
  label: string;
}) {
  const ready = value.length >= PIN_MIN;
  const add = (digit: string) => {
    if (!disabled && value.length < PIN_MAX) onChange(value + digit);
  };
  const remove = () => {
    if (!disabled) onChange(value.slice(0, -1));
  };
  const submit = () => {
    if (!disabled && ready) onSubmit();
  };

  const onKey = useLatest((e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    // Typing into a real box elsewhere on the screen is not typing a PIN.
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
    // Enter or Space on a focused button already presses that button.
    if (target?.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;
    if (/^[0-9]$/.test(e.key)) add(e.key);
    else if (e.key === 'Backspace') remove();
    else if (e.key === 'Enter') submit();
    else return;
    e.preventDefault();
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onKey(e);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [onKey]);

  return (
    <div className="pin" role="group" aria-label={label}>
      <p className="pin-dots" aria-hidden="true">
        {'●'.repeat(value.length)}
      </p>
      <p className="sr-only" aria-live="polite">
        {value.length === 1 ? '1 digit entered' : `${value.length} digits entered`}
      </p>
      <div className="pin-pad">
        {DIGITS.map((digit) => (
          <button key={digit} type="button" className="btn pin-key" disabled={disabled} onClick={() => add(digit)}>
            {digit}
          </button>
        ))}
        <button
          type="button"
          className="btn btn-quiet pin-key pin-word"
          disabled={disabled || value.length === 0}
          onClick={remove}
        >
          Delete
        </button>
        <button type="button" className="btn pin-key" disabled={disabled} onClick={() => add('0')}>
          0
        </button>
        <button type="button" className="btn btn-primary pin-key pin-word" disabled={disabled || !ready} onClick={submit}>
          {submitLabel}
        </button>
      </div>
    </div>
  );
}
