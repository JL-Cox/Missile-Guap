import { useState } from 'react';
import { addCapture } from '../db';

/**
 * The most important control in the app. One box, always in the same place,
 * on every screen. No category, no date, no priority, no decision of any kind -
 * type the thing and it is safely written down. Sorting happens later, or never.
 *
 * It sits as one line until you are in it, so it costs one line rather than
 * three on the screens you mostly open to read. It stays exactly where it was:
 * only its height changes, and the hint about Enter appears when you can use it.
 */
export default function CaptureBar({ onSaved }: { onSaved: (text: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const open = focused || text.length > 0;

  /**
   * `fromKeyboard` is Enter in the box: you are still typing, so the box stays
   * open for the next thing. From the button, the box folds back to one line -
   * the button disables itself once the box is empty, and a disabled button
   * drops focus without telling anyone, so it is closed here on purpose.
   */
  const save = async (fromKeyboard: boolean) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await addCapture(trimmed);
      setText('');
      if (!fromKeyboard) setFocused(false);
      onSaved(trimmed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={`capture${open ? ' capture-open' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        void save(false);
      }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        // Moving from the box to its own Save button is still "in it".
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <label htmlFor="capture-input">Write it down</label>
      <textarea
        autoComplete="off"
        id="capture-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Anything at all. Sort it out later."
        rows={open ? 2 : 1}
        aria-describedby={open ? 'capture-hint' : undefined}
        onKeyDown={(e) => {
          // Enter saves, Shift+Enter makes a new line. Both are stated in the hint below.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save(true);
          }
        }}
      />
      {open && (
        <div className="spread">
          <span className="faint" id="capture-hint">
            Enter saves. Shift+Enter starts a new line.
          </span>
          <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim() || busy}>
            Save to inbox
          </button>
        </div>
      )}
    </form>
  );
}
