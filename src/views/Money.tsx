import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankSubscription, db, saveSubscription } from '../db';
import type { BillingCycle, Settings, Subscription } from '../types';
import { byCategoryYearly, formatMoney, monthlyMinor, parseMoney, totalMonthlyMinor, totalYearlyMinor, yearlyMinor } from '../lib/money';
import { describeCycle, nextBilling } from '../lib/recurrence';
import { upcomingBills } from '../lib/agenda';
import { describeDate, todayKey } from '../lib/time';
import { Amount, ConfirmButton, Empty, Section, useAutoFocus } from '../components/ui';

const CYCLES: { id: BillingCycle; label: string }[] = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Every 3 months' },
  { id: 'yearly', label: 'Yearly' },
];

/**
 * Subscriptions are the classic forgetting tax: money leaving for something you
 * stopped using, and the cancel page is never where you expect. So the two
 * things this screen insists on are "when is the next charge" and "how do I
 * actually get out of this", written down while you still know.
 */
export default function Money({ settings }: { settings: Settings }) {
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const today = todayKey();

  const subs = useLiveQuery(() => db.subscriptions.toArray(), [settings.rev], [] as Subscription[]) ?? [];
  const active = subs.filter((s) => !s.endedOn).sort((a, b) => yearlyMinor(b) - yearlyMinor(a));
  const ended = subs.filter((s) => s.endedOn);

  if (editing) {
    return (
      <SubscriptionEditor
        sub={editing}
        currency={settings.currency}
        onSaved={() => setEditing(null)}
        onCancel={() => setEditing(null)}
        onDelete={async (s) => {
          await db.subscriptions.delete(s.id);
          setEditing(null);
        }}
      />
    );
  }

  const monthly = totalMonthlyMinor(subs);
  const yearly = totalYearlyMinor(subs);
  const categories = byCategoryYearly(subs);
  const maxCategory = categories[0]?.minor ?? 1;
  const soon = upcomingBills(subs, settings.lookaheadDays, today);

  return (
    <>
      <Section
        title="Subscriptions"
        aside={
          <button type="button" className="btn btn-sm" onClick={() => setEditing(blankSubscription({ currency: settings.currency }))}>
            Add one
          </button>
        }
      >
        {active.length === 0 ? (
          <Empty>
            Nothing tracked yet. Add anything that takes money on a repeat: streaming, phone, gym, storage, that
            app you signed up to once.
          </Empty>
        ) : (
          <div className="card stack-sm">
            <div className="spread">
              <span className="muted">Every month, roughly</span>
              <Amount text={formatMoney(monthly, settings.currency)} blur={settings.blurAmounts} />
            </div>
            <div className="spread">
              <span className="muted">Every year</span>
              <Amount text={formatMoney(yearly, settings.currency)} blur={settings.blurAmounts} />
            </div>
            <p className="faint">
              {active.length} active {active.length === 1 ? 'subscription' : 'subscriptions'}. Weekly costs are
              counted as 52 a year, so the monthly figure is an average rather than an exact bill.
            </p>
          </div>
        )}
      </Section>

      {soon.length > 0 && (
        <Section title={`Charging in the next ${settings.lookaheadDays} days`}>
          <div className="stack-sm">
            {soon.map((b) => (
              <div key={`${b.sub.id}-${b.date}`} className="item">
                <div className="grow">
                  <div className="item-title">{b.sub.name}</div>
                  <div className="faint">{describeDate(b.date, today)}</div>
                </div>
                <Amount text={formatMoney(b.sub.amountMinor, b.sub.currency)} blur={settings.blurAmounts} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {categories.length > 1 && (
        <Section title="Where the money goes each year">
          <div className="stack-sm">
            {categories.map((c) => (
              <div key={c.category} className="stack-sm">
                <div className="spread">
                  <span className="small">{c.category}</span>
                  <Amount text={formatMoney(c.minor, settings.currency)} blur={settings.blurAmounts} />
                </div>
                <div className="bar-track">
                  <div className="bar" style={{ width: `${Math.max(3, (c.minor / maxCategory) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {active.length > 0 && (
        <Section title="All of them">
          <div className="stack-sm">
            {active.map((sub) => (
              <SubscriptionCard key={sub.id} sub={sub} settings={settings} onEdit={setEditing} />
            ))}
          </div>
        </Section>
      )}

      {ended.length > 0 && (
        <Section title="Cancelled">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShowEnded((v) => !v)}>
            {showEnded ? 'Hide' : 'Show'} {ended.length} cancelled
          </button>
          {showEnded && (
            <div className="stack-sm">
              {ended.map((sub) => (
                <div key={sub.id} className="item">
                  <div className="grow">
                    <div className="item-title">{sub.name}</div>
                    <div className="faint">Stopped {describeDate(sub.endedOn!, today)}</div>
                  </div>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditing(sub)}>
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="faint">Kept so you can see what you used to pay for, and restart one if you need it back.</p>
        </Section>
      )}
    </>
  );
}

function SubscriptionCard({
  sub,
  settings,
  onEdit,
}: {
  sub: Subscription;
  settings: Settings;
  onEdit: (sub: Subscription) => void;
}) {
  const [open, setOpen] = useState(false);
  const next = nextBilling(sub);

  return (
    <div className="card card-tight stack-sm">
      <div className="spread">
        <button
          type="button"
          className="item-title grow"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
        >
          {sub.name}
        </button>
        <Amount text={formatMoney(sub.amountMinor, sub.currency)} blur={settings.blurAmounts} />
      </div>
      <div className="row-tight faint">
        <span>{describeCycle(sub.cycle, sub.every)}</span>
        {next && <span>Next: {describeDate(next)}</span>}
        {sub.category && <span className="tag">{sub.category}</span>}
      </div>

      {open && (
        <div className="stack-sm">
          <div className="spread small">
            <span className="muted">Works out at</span>
            <Amount
              text={`${formatMoney(monthlyMinor(sub), sub.currency)} a month / ${formatMoney(yearlyMinor(sub), sub.currency)} a year`}
              blur={settings.blurAmounts}
            />
          </div>
          {sub.cancelHow.trim() ? (
            <div className="card card-quiet">
              <strong className="small">To cancel:</strong>
              <p className="note-body">{sub.cancelHow}</p>
            </div>
          ) : (
            <p className="faint">
              No cancellation steps written down. Worth adding now, while you can find them.
            </p>
          )}
          {sub.notes.trim() && <p className="note-body">{sub.notes}</p>}
          <div className="btn-row">
            <button type="button" className="btn btn-sm" onClick={() => onEdit(sub)}>
              Edit
            </button>
            <ConfirmButton
              label="Mark as cancelled"
              confirmLabel="Yes, it's cancelled"
              className="btn btn-quiet btn-sm"
              onConfirm={() => void saveSubscription({ ...sub, endedOn: todayKey() })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function SubscriptionEditor({
  sub,
  currency,
  onSaved,
  onCancel,
  onDelete,
}: {
  sub: Subscription;
  currency: string;
  onSaved: () => void;
  onCancel: () => void;
  onDelete: (sub: Subscription) => void;
}) {
  const [draft, setDraft] = useState({ ...sub, currency: sub.currency || currency });
  const [amountText, setAmountText] = useState(sub.amountMinor ? (sub.amountMinor / 100).toFixed(2) : '');
  const [error, setError] = useState('');
  const nameRef = useAutoFocus<HTMLInputElement>();

  const patch = (changes: Partial<Subscription>) => setDraft((d) => ({ ...d, ...changes }));

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const amountMinor = parseMoney(amountText);
        if (amountMinor === null) {
          setError("That amount isn't a number I can read. Try something like 12.99.");
          return;
        }
        if (!draft.name.trim()) return;
        await saveSubscription({ ...draft, name: draft.name.trim(), amountMinor });
        onSaved();
      }}
    >
      <div className="field">
        <label htmlFor="sub-name">What is it?</label>
        <input
          id="sub-name"
          ref={nameRef}
          type="text"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Netflix"
        />
      </div>

      <div className="field-row">
        <div className="field">
          <label htmlFor="sub-amount">How much, each time</label>
          <input
            id="sub-amount"
            type="text"
            inputMode="decimal"
            value={amountText}
            onChange={(e) => {
              setAmountText(e.target.value);
              setError('');
            }}
            placeholder="12.99"
          />
        </div>
        <div className="field">
          <label htmlFor="sub-currency">Currency</label>
          <input
            id="sub-currency"
            type="text"
            value={draft.currency}
            onChange={(e) => patch({ currency: e.target.value.toUpperCase().slice(0, 3) })}
            placeholder="GBP"
          />
        </div>
      </div>
      {error && <p className="pill pill-warn">{error}</p>}

      <div className="field-row">
        <div className="field">
          <label htmlFor="sub-cycle">How often</label>
          <select
            id="sub-cycle"
            value={draft.cycle}
            onChange={(e) => patch({ cycle: e.target.value as BillingCycle })}
          >
            {CYCLES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sub-every">Every how many?</label>
          <input
            id="sub-every"
            type="number"
            min={1}
            max={24}
            value={draft.every}
            onChange={(e) => patch({ every: Math.max(1, Number(e.target.value) || 1) })}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="sub-first">Date of the next (or first) charge</label>
        <input
          id="sub-first"
          type="date"
          value={draft.firstBilled}
          onChange={(e) => patch({ firstBilled: e.target.value })}
        />
        <p className="faint">Every future date is worked out from this one, so it only has to be right once.</p>
      </div>

      <div className="field">
        <label htmlFor="sub-remind">Warn me before each charge</label>
        <select
          id="sub-remind"
          value={draft.remindDaysBefore}
          onChange={(e) => patch({ remindDaysBefore: Number(e.target.value) })}
        >
          <option value={0}>Don't warn me</option>
          <option value={1}>1 day before</option>
          <option value={3}>3 days before</option>
          <option value={7}>A week before</option>
          <option value={14}>2 weeks before</option>
        </select>
        <p className="faint">Used when you export to your calendar, from Settings.</p>
      </div>

      <div className="field">
        <label htmlFor="sub-cancel">How do you cancel it?</label>
        <textarea
          id="sub-cancel"
          value={draft.cancelHow}
          onChange={(e) => patch({ cancelHow: e.target.value })}
          placeholder="Account > Membership > Cancel. Or: ring 0800 123 4567, account number 12345."
        />
        <p className="faint">
          Write this down now, while you are already looking at it. Future you will not want to go hunting.
        </p>
      </div>

      <div className="field">
        <label htmlFor="sub-category">Category (optional)</label>
        <input
          id="sub-category"
          type="text"
          value={draft.category ?? ''}
          onChange={(e) => patch({ category: e.target.value || undefined })}
          placeholder="Entertainment, bills, health"
        />
      </div>

      <div className="field">
        <label htmlFor="sub-notes">Notes (optional)</label>
        <textarea
          id="sub-notes"
          value={draft.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          placeholder="Which card it comes off, who else uses it..."
        />
      </div>

      {draft.endedOn && (
        <div className="card card-quiet spread">
          <span className="small">Marked as cancelled on {describeDate(draft.endedOn)}.</span>
          <button type="button" className="btn btn-sm" onClick={() => patch({ endedOn: undefined })}>
            It's active again
          </button>
        </div>
      )}

      <div className="spread">
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={!draft.name.trim()}>
            Save
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <ConfirmButton
          label="Delete"
          confirmLabel="Yes, delete it"
          className="btn btn-quiet btn-sm"
          onConfirm={() => onDelete(draft)}
        />
      </div>
    </form>
  );
}
