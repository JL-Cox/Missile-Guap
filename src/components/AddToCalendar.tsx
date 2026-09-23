import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getSettings } from '../db';
import { CALENDAR_CAUTION, calendarContents, type CalendarKind, type CalendarOptions } from '../lib/ics';
import { shareOrDownload } from '../lib/share';

/**
 * Hands one item to the phone's calendar. On Android this opens the share
 * sheet, so Google Calendar is one tap away; where that is unavailable it
 * saves the .ics, which Android still offers to open with a calendar app.
 *
 * `build` returns null when there is nothing to add - a cancelled subscription,
 * or a task with no date - and the button says so instead of doing nothing.
 *
 * Whether notes go in is read from Settings here rather than passed down, so
 * every calendar button follows the one switch, and the line under the button
 * always says what that switch means for this particular file.
 */
export default function AddToCalendar({
  build,
  kind,
  filename,
  className = 'btn btn-sm',
  nothingToAdd,
}: {
  build: (options: CalendarOptions) => string | null;
  kind: CalendarKind;
  filename: string;
  className?: string;
  nothingToAdd: string;
}) {
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'nothing'>('idle');
  const includeNotes = useLiveQuery(async () => (await getSettings()).calendarIncludeNotes, [], false) ?? false;

  const go = async () => {
    setState('working');
    // Read again at the moment of sending, so the file matches the switch
    // even if it changed a second ago on another screen.
    const ics = build({ includeNotes: (await getSettings()).calendarIncludeNotes });
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
      <span className="faint">
        {calendarContents(kind, includeNotes)} {CALENDAR_CAUTION}
      </span>
    </span>
  );
}
