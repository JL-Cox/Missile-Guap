import { useState } from 'react';
import type { Subscription } from '../types';
import { shareOrDownload } from '../lib/share';
import { subscriptionsCsv, subscriptionsExportContents, subscriptionsFilename } from '../lib/subexport';
import { todayKey } from '../lib/time';

/**
 * Sends your subscriptions somewhere else as a spreadsheet file - to look for
 * overlaps and cheaper plans with a spreadsheet, or with an assistant.
 *
 * It goes the same way a backup or a calendar file does: the phone's share
 * sheet, where you pick the app, or a plain download. Nothing is sent anywhere
 * by itself. The notes box is not remembered, so every export starts with
 * notes left out.
 */
export default function ExportSubscriptions({ subs }: { subs: Subscription[] }) {
  const [includeNotes, setIncludeNotes] = useState(false);
  const [state, setState] = useState<'idle' | 'working' | 'shared' | 'downloaded'>('idle');

  const go = async () => {
    setState('working');
    const today = todayKey();
    const outcome = await shareOrDownload(
      subscriptionsFilename(today),
      subscriptionsCsv(subs, { today, includeNotes }),
      'text/csv',
    );
    setState(outcome === 'cancelled' ? 'idle' : outcome);
  };

  return (
    <div className="card stack-sm">
      <h3>Look for savings somewhere else</h3>
      <p className="small">
        A spreadsheet file of what you pay for, to open in a spreadsheet or hand to an assistant and ask which
        ones overlap or have a cheaper plan.
      </p>
      <label className="check">
        <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} />
        <span>Include my notes</span>
      </label>
      <div className="btn-row">
        <button type="button" className="btn btn-sm" onClick={() => void go()} disabled={state === 'working'}>
          Export my subscriptions
        </button>
      </div>
      {state === 'shared' && <p className="faint">Sent to the app you picked.</p>}
      {state === 'downloaded' && <p className="faint">Saved to your downloads.</p>}
      <p className="faint">
        {subscriptionsExportContents(includeNotes)} Wherever you send it can read all of it, so pick somewhere
        you trust.
      </p>
    </div>
  );
}
