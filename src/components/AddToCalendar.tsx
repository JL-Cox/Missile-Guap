import { useState } from 'react';
import { shareOrDownload } from '../lib/share';

/**
 * Hands one item to the phone's calendar. On Android this opens the share
 * sheet, so Google Calendar is one tap away; where that is unavailable it
 * saves the .ics, which Android still offers to open with a calendar app.
 *
 * `build` returns null when there is nothing to add - a cancelled subscription,
 * or a task with no date - and the button says so instead of doing nothing.
 */
export default function AddToCalendar({
  build,
  filename,
  className = 'btn btn-sm',
  nothingToAdd,
}: {
  build: () => string | null;
  filename: string;
  className?: string;
  nothingToAdd: string;
}) {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'nothing'>('idle');

  const go = async () => {
    setState('working');
    const ics = build();
    if (!ics) {
      setState('nothing');
      return;
    }
    const outcome = await shareOrDownload(filename, ics, 'text/calendar');
    setState(outcome === 'cancelled' ? 'idle' : 'done');
  };

  if (state === 'nothing') return <p className="faint">{nothingToAdd}</p>;

  return (
    <span className="stack-sm">
      <button type="button" className={className} onClick={() => void go()} disabled={state === 'working'}>
        {state === 'done' ? 'Send to my calendar again' : 'Add to my calendar'}
      </button>
      {state === 'done' && (
        <span className="faint">
          Sent. If it saved as a file instead of opening, tap the download and pick your calendar app.
        </span>
      )}
    </span>
  );
}
