import { useState } from 'react';
import { addCapture } from '../db';

/**
 * The most important control in the app. One box, always in the same place,
 * on every screen. No category, no date, no priority, no decision of any kind -
 * type the thing and it is safely written down. Sorting happens later, or never.
 */
export default function CaptureBar({ onSaved }: { onSaved: (text: string) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await addCapture(trimmed);
      setText('');
      onSaved(trimmed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="capture"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label htmlFor="capture-input">Write it down</label>
      <textarea
        autoComplete="off"
        id="capture-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Anything at all. Sort it out later."
        rows={2}
        onKeyDown={(e) => {
          // Enter saves, Shift+Enter makes a new line. Both are stated in the hint below.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
        }}
      />
      <div className="spread">
        <span className="faint">Enter saves. Shift+Enter starts a new line.</span>
        <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim() || busy}>
          Save to inbox
        </button>
      </div>
    </form>
  );
}
