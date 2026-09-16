import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankSubscription, db, saveSubscription } from '../db';
import type { Settings, Subscription } from '../types';
import {
  byCategoryYearly,
  formatMoney,
  monthlyMinor,
  parseMoney,
  totalMonthlyMinor,
  totalYearlyMinor,
  yearlyMinor,
} from '../lib/money';
import { describeCycle, nextBilling } from '../lib/recurrence';
import { upcomingBills } from '../lib/agenda';
import { calendarForSubscription, icsFilename } from '../lib/ics';
import AddToCalendar from '../components/AddToCalendar';
import {
  categoryChoices,
  cycleUnit,
  CYCLE_PRESETS,
  findCyclePreset,
  findPreset,
  matchPresets,
  type ServicePreset,
} from '../lib/subscriptions';
import { addDays, describeDate, todayKey } from '../lib/time';
import { Amount, ConfirmButton, Empty, Section, useAutoFocus } from '../components/ui';

/**
 * Subscriptions are the classic forgetting tax: money leaving for something you
 * stopped using, and the cancel page is never where you expect. So the two
 * things this screen insists on are "when is the next charge" and "how do I
 * actually get out of this", written down while you still know.
 *
 * Adding one is meant to be a single journey: tap Add, fill in three fields,
 * and the next screen already knows what it costs a year, when it next charges,
 * and offers to put it in your phone's calendar. No trip to Settings.
 */
export default function Money({ settings }: { settings: Settings }) {
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [justSaved, setJustSaved] = useState<Subscription | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const today = todayKey();

  const subs = useLiveQuery(() => db.subscriptions.toArray(), [settings.rev], [] as Subscription[]) ?? [];
  const active = subs.filter((s) => !s.endedOn).sort((a, b) => yearlyMinor(b) - yearlyMinor(a));
  const ended = subs.filter((s) => s.endedOn);

  const startNew = () => {
    setJustSaved(null);
    setEditing(blankSubscription({ currency: settings.currency, firstBilled: today }));
  };

  if (editing) {
    return (
      <SubscriptionEditor
        sub={editing}
        knownCategories={categoryChoices(subs.map((s) => s.category))}
        onSaved={(saved) => {
          setEditing(null);
          setJustSaved(saved);
        }}
        onCancel={() => setEditing(null)}
        onDelete={async (s) => {
          await db.subscriptions.delete(s.id);
          setEditing(null);
        }}
      />
    );
  }

  if (justSaved) {
    return (
      <SavedConfirmation
        sub={justSaved}
        blurAmounts={settings.blurAmounts}
        onAddAnother={startNew}
        onEdit={() => {
          setJustSaved(null);
          setEditing(justSaved);
        }}
        onDone={() => setJustSaved(null)}
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
      <Section title="Subscriptions">
        {/* The primary action is a full-width button, not a small one tucked
            into the heading. Adding one should never be a thing you hunt for. */}
        <button type="button" className="btn btn-primary btn-wide" onClick={startNew}>
          Add a subscription
        </button>

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

/**
 * The screen straight after saving. It exists because "$12.99 a month" and
 * "$155.88 a year" are very different pieces of information, and the second one
 * is the one that changes your mind. It also puts the calendar step here, where
 * you are already thinking about this subscription.
 */
function SavedConfirmation({
  sub,
  blurAmounts,
  onAddAnother,
  onEdit,
  onDone,
}: {
  sub: Subscription;
  blurAmounts: boolean;
  onAddAnother: () => void;
  onEdit: () => void;
  onDone: () => void;
}) {
  const next = nextBilling(sub);

  return (
    <Section title={`${sub.name} is saved`}>
      <div className="card stack-sm">
        <div className="spread">
          <span className="muted">Each charge</span>
          <Amount text={formatMoney(sub.amountMinor, sub.currency)} blur={blurAmounts} />
        </div>
        <div className="spread">
          <span className="muted">How often</span>
          <span>{describeCycle(sub.cycle, sub.every)}</span>
        </div>
        <div className="spread">
          <span className="muted">Next charge</span>
          <span>{next ? describeDate(next) : 'None - it is cancelled'}</span>
        </div>
        <hr className="divider" />
        <div className="spread">
          <span className="muted">That works out at</span>
          <Amount text={`${formatMoney(monthlyMinor(sub), sub.currency)} a month`} blur={blurAmounts} />
        </div>
        <div className="spread">
          <span className="muted">Over a year</span>
          <Amount text={formatMoney(yearlyMinor(sub), sub.currency)} blur={blurAmounts} />
        </div>
        {sub.category && (
          <div className="spread">
            <span className="muted">Filed under</span>
            <span className="tag">{sub.category}</span>
          </div>
        )}
      </div>

      <AddToCalendar
        build={() => calendarForSubscription(sub, formatMoney(sub.amountMinor, sub.currency))}
        filename={icsFilename(sub.name)}
        className="btn btn-primary btn-wide"
        nothingToAdd="This one is cancelled, so there is nothing to put in a calendar."
      />
      <p className="faint">
        Adds a repeating entry on every charge date
        {sub.remindDaysBefore > 0
          ? `, with a reminder ${sub.remindDaysBefore} day${sub.remindDaysBefore === 1 ? '' : 's'} before each one`
          : ''}
        . Your phone's calendar does the reminding from then on, whether or not Steady is open.
      </p>

      {!sub.cancelHow.trim() && (
        <div className="card card-quiet stack-sm">
          <p className="small">
            You haven't written down how to cancel this one. It takes a minute now and saves a bad half hour later.
          </p>
          <button type="button" className="btn btn-sm" onClick={onEdit}>
            Add the cancellation steps
          </button>
        </div>
      )}

      <div className="btn-row">
        <button type="button" className="btn" onClick={onDone}>
          Done
        </button>
        <button type="button" className="btn" onClick={onAddAnother}>
          Add another
        </button>
        <button type="button" className="btn btn-quiet" onClick={onEdit}>
          Change something
        </button>
      </div>
    </Section>
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
          <AddToCalendar
            build={() => calendarForSubscription(sub, formatMoney(sub.amountMinor, sub.currency))}
            filename={icsFilename(sub.name)}
            nothingToAdd="This one is cancelled, so there is nothing to put in a calendar."
          />
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
  knownCategories,
  onSaved,
  onCancel,
  onDelete,
}: {
  sub: Subscription;
  knownCategories: string[];
  onSaved: (sub: Subscription) => void;
  onCancel: () => void;
  onDelete: (sub: Subscription) => void;
}) {
  const [draft, setDraft] = useState(sub);
  const [amountText, setAmountText] = useState(sub.amountMinor ? (sub.amountMinor / 100).toFixed(2) : '');
  const [error, setError] = useState('');
  const [showMore, setShowMore] = useState(Boolean(sub.cancelHow || sub.notes || sub.every !== 1));
  const [customCategory, setCustomCategory] = useState(
    Boolean(sub.category && !knownCategories.includes(sub.category)),
  );
  const nameRef = useAutoFocus<HTMLInputElement>();

  const patch = (changes: Partial<Subscription>) => setDraft((d) => ({ ...d, ...changes }));

  const nameMatches = matchPresets(draft.name);

  /**
   * Taking a suggestion fills in the category and the usual billing rhythm too,
   * so the common case is name, amount, date and nothing else. It only ever
   * fills blanks - it never overwrites something you chose.
   */
  const applyPreset = (preset: ServicePreset) =>
    patch({
      name: preset.name,
      category: draft.category ?? preset.category,
      cycle: draft.cycle === 'monthly' ? preset.cycle : draft.cycle,
      every: draft.cycle === 'monthly' ? 1 : draft.every,
    });

  /** Typing the full name of a known service counts as picking it. */
  const onNameChange = (name: string) => {
    const preset = findPreset(name);
    if (preset) return applyPreset(preset);
    patch({ name });
  };

  const today = todayKey();

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
        onSaved(await saveSubscription({ ...draft, name: draft.name.trim(), amountMinor }));
      }}
    >
      <div className="field">
        <label htmlFor="sub-name">What is it?</label>
        <input
          id="sub-name"
          ref={nameRef}
          type="text"
          value={draft.name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Netflix"
          autoComplete="off"
        />
        {nameMatches.length > 0 && (
          <div className="btn-row" style={{ marginTop: 8 }}>
            {nameMatches.map((p) => (
              <button
                key={p.name}
                type="button"
                className="btn btn-sm"
                onClick={() => applyPreset(p)}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        <p className="faint">Start typing and common ones will offer themselves, category included.</p>
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
            placeholder="USD"
          />
        </div>
      </div>
      {error && <p className="pill pill-warn">{error}</p>}

      <div className="field">
        <label>How often</label>
        <div className="btn-row">
          {CYCLE_PRESETS.map((c) => {
            const selected = findCyclePreset(draft.cycle, draft.every)?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={selected}
                className={`btn btn-sm${selected ? ' btn-primary' : ''}`}
                // A preset sets both fields, so picking one can never leave a
                // stale "every 2" behind from a previous choice.
                onClick={() => patch({ cycle: c.cycle, every: c.every })}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        {!findCyclePreset(draft.cycle, draft.every) && (
          <p className="faint">
            Currently {describeCycle(draft.cycle, draft.every)}, which none of these cover. Picking one would
            change when it charges; leave them alone to keep it as it is.
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="sub-first">Date of the next charge</label>
        <div className="btn-row" style={{ marginBottom: 8 }}>
          <button
            type="button"
            aria-pressed={draft.firstBilled === today}
            className={`btn btn-sm${draft.firstBilled === today ? ' btn-primary' : ''}`}
            onClick={() => patch({ firstBilled: today })}
          >
            Today
          </button>
          <button
            type="button"
            aria-pressed={draft.firstBilled === addDays(today, 1)}
            className={`btn btn-sm${draft.firstBilled === addDays(today, 1) ? ' btn-primary' : ''}`}
            onClick={() => patch({ firstBilled: addDays(today, 1) })}
          >
            Tomorrow
          </button>
          <button
            type="button"
            aria-pressed={draft.firstBilled === addDays(today, 7)}
            className={`btn btn-sm${draft.firstBilled === addDays(today, 7) ? ' btn-primary' : ''}`}
            onClick={() => patch({ firstBilled: addDays(today, 7) })}
          >
            In a week
          </button>
        </div>
        <input
          id="sub-first"
          type="date"
          value={draft.firstBilled}
          onChange={(e) => patch({ firstBilled: e.target.value })}
        />
        <p className="faint">
          {describeDate(draft.firstBilled)}. Every future date is worked out from this one, so it only has to be
          right once.
        </p>
      </div>

      <div className="field">
        <label>Category</label>
        <div className="btn-row">
          {knownCategories.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={draft.category === c}
              className={`btn btn-sm${draft.category === c ? ' btn-primary' : ''}`}
              onClick={() => {
                setCustomCategory(false);
                patch({ category: draft.category === c ? undefined : c });
              }}
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={customCategory}
            className={`btn btn-sm${customCategory ? ' btn-primary' : ''}`}
            onClick={() => {
              setCustomCategory(true);
              patch({ category: '' });
            }}
          >
            Something else
          </button>
        </div>
        {customCategory && (
          <input
            type="text"
            aria-label="Your own category"
            value={draft.category ?? ''}
            onChange={(e) => patch({ category: e.target.value || undefined })}
            placeholder="Type your own"
            style={{ marginTop: 8 }}
          />
        )}
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
        <p className="faint">Becomes the alarm on the calendar entry you can add on the next screen.</p>
      </div>

      {!showMore ? (
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShowMore(true)}>
          More options (how to cancel, notes, every N cycles)
        </button>
      ) : (
        <>
          <hr className="divider" />

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
            <label htmlFor="sub-every">Bill every how many {cycleUnit(draft.cycle)}?</label>
            <input
              id="sub-every"
              type="number"
              min={1}
              max={24}
              value={draft.every}
              onChange={(e) => patch({ every: Math.max(1, Number(e.target.value) || 1) })}
            />
            <p className="faint">
              Only needed for a rhythm the buttons above do not cover, like every 2 months.
            </p>
          </div>

          <div className="field">
            <label htmlFor="sub-notes">Notes</label>
            <textarea
              id="sub-notes"
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Which card it comes off, who else uses it..."
            />
          </div>
        </>
      )}

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
