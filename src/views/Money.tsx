import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankIncome, blankSubscription, db, saveSubscription } from '../db';
import type { IncomeSource, Settings, Subscription } from '../types';
import {
  byCategoryYearly,
  deductionsByLabel,
  formatMoney,
  isActive,
  leftoverMonthlyMinor,
  netMonthlyMinor,
  totalGrossYearlyMinor,
  totalNetMonthlyMinor,
  totalNetYearlyMinor,
  monthlyMinor,
  parseMoney,
  totalMonthlyMinor,
  totalYearlyMinor,
  yearlyMinor,
} from '../lib/money';
import {
  DEFAULT_BILLING_DAYS,
  describeBilling,
  describeCycle,
  isFixedDayCycle,
  nextBilling,
} from '../lib/recurrence';
import { normaliseDays } from '../lib/monthdays';
import { outlook, stillToCome, whyNoPayPeriod } from '../lib/cashflow';
import { upcomingBills } from '../lib/agenda';
import { calendarForSubscription, icsFilename } from '../lib/ics';
import AddToCalendar from '../components/AddToCalendar';
import IncomeEditor from '../components/IncomeEditor';
import { describeFrequency, isActiveIncome, nextPayday } from '../lib/pay';
import {
  BILLING_DAY_CHOICES,
  categoryChoices,
  cycleUnit,
  CYCLE_PRESETS,
  findCyclePreset,
  matchPresets,
  whenNameTyped,
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
  const [editingIncome, setEditingIncome] = useState<IncomeSource | null>(null);
  const [justSaved, setJustSaved] = useState<Subscription | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [showEndedIncome, setShowEndedIncome] = useState(false);
  const today = todayKey();

  const subs = useLiveQuery(() => db.subscriptions.toArray(), [settings.rev], [] as Subscription[]) ?? [];
  const incomes = useLiveQuery(() => db.incomes.toArray(), [settings.rev], [] as IncomeSource[]) ?? [];
  const active = subs.filter((s) => !s.endedOn).sort((a, b) => yearlyMinor(b) - yearlyMinor(a));
  const ended = subs.filter((s) => s.endedOn);

  const startNew = () => {
    setJustSaved(null);
    setEditing(blankSubscription({ currency: settings.currency, firstBilled: today }));
  };

  if (editingIncome) {
    // Delete only means something for an income that has been saved.
    const saved = incomes.some((i) => i.id === editingIncome.id);
    return (
      <IncomeEditor
        source={editingIncome}
        blurAmounts={settings.blurAmounts}
        onSaved={() => setEditingIncome(null)}
        onCancel={() => setEditingIncome(null)}
        onDelete={
          saved
            ? async (s) => {
                await db.incomes.delete(s.id);
                setEditingIncome(null);
              }
            : undefined
        }
      />
    );
  }

  if (editing) {
    const isSaved = subs.some((s) => s.id === editing.id);
    return (
      <SubscriptionEditor
        sub={editing}
        knownCategories={categoryChoices(subs.map((s) => s.category))}
        onSaved={(saved) => {
          setEditing(null);
          setJustSaved(saved);
        }}
        onCancel={() => setEditing(null)}
        onDelete={
          isSaved
            ? async (s) => {
                await db.subscriptions.delete(s.id);
                setEditing(null);
              }
            : undefined
        }
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

  const activeIncomes = incomes.filter(isActiveIncome);
  const endedIncomes = incomes.filter((src) => !isActiveIncome(src));
  const netMonthly = totalNetMonthlyMinor(incomes);
  const leftover = leftoverMonthlyMinor(incomes, subs);
  const grossYearly = totalGrossYearlyMinor(incomes);
  const netYearly = totalNetYearlyMinor(incomes);
  const deductionRows = deductionsByLabel(incomes);
  const maxDeduction = deductionRows[0]?.minor ?? 1;

  // Real dates rather than monthly averages: what is still going to leave the
  // account before more money arrives, which is the question an average hides.
  const pending = stillToCome(incomes, subs, today);
  const noPeriod = pending.period ? null : whyNoPayPeriod(incomes, today);
  const cheques = outlook(incomes, subs, today, 4);

  return (
    <>
      <Section title="Income">
        <button
          type="button"
          className="btn btn-primary btn-wide"
          onClick={() => setEditingIncome(blankIncome({ currency: settings.currency }))}
        >
          Add income
        </button>

        {activeIncomes.length === 0 ? (
          <Empty>
            Add a paycheque and the figures below stop being half a picture. You type gross and net straight off
            the stub - nothing here tries to work out your tax.
          </Empty>
        ) : (
          <div className="stack-sm">
            {activeIncomes.map((src) => {
              const payday = nextPayday(src, today);
              return (
                <div key={src.id} className="card card-tight stack-sm">
                  <div className="spread">
                    <span className="item-title grow">{src.name}</span>
                    <Amount text={formatMoney(src.netMinor, src.currency)} blur={settings.blurAmounts} />
                  </div>
                  <div className="row-tight faint">
                    <span>{describeFrequency(src)}</span>
                    {payday && <span>Next: {describeDate(payday, today)}</span>}
                    <span>
                      <Amount text={`${formatMoney(netMonthlyMinor(src), src.currency)} a month`} blur={settings.blurAmounts} />
                    </span>
                  </div>
                  <div className="btn-row">
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditingIncome(src)}>
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      {subs.some((s) => isActive(s, today)) && (
        <Section title="Still to come out">
          <div className="card stack-sm">
            <div className="spread">
              <div className="grow">
                <div className="item-title">Rest of this month</div>
                <div className="faint">
                  {pending.month.count === 0
                    ? 'Nothing else is due'
                    : `${pending.month.count} ${pending.month.count === 1 ? 'charge' : 'charges'}, up to ${describeDate(pending.month.until, today)}`}
                </div>
              </div>
              <Amount text={formatMoney(pending.month.minor, settings.currency)} blur={settings.blurAmounts} />
            </div>

            {pending.period ? (
              <div className="spread">
                <div className="grow">
                  <div className="item-title">Before your next payday</div>
                  <div className="faint">
                    {pending.period.count === 0
                      ? 'Nothing else is due'
                      : `${pending.period.count} ${pending.period.count === 1 ? 'charge' : 'charges'}, up to ${describeDate(pending.period.until, today)}`}
                  </div>
                </div>
                <Amount text={formatMoney(pending.period.minor, settings.currency)} blur={settings.blurAmounts} />
              </div>
            ) : (
              <p className="faint">
                {noPeriod?.kind === 'needsRecentPayday'
                  ? `Add a recent payday to ${noPeriod.source.name} so paydays can be worked out. Then this will also show what is due before your next payday.`
                  : noPeriod?.kind === 'noIncome'
                    ? 'Add your income above and this will also show what is due before your next payday.'
                    : "Paydays can't be worked out from the income above yet, so what is due before your next payday is left out."}
              </p>
            )}
            <p className="faint">
              Counted from today on the real charge dates, so a bill that already went out this month is not
              in here.
            </p>
          </div>
        </Section>
      )}

      {cheques.length > 0 && (
        <Section title="Each paycheck">
          <p className="faint">
            What each one has to cover before the next arrives. Only the subscriptions this app knows
            about — rent, food, fuel and everything else still come out of what is left.
          </p>
          {cheques.map((c) => (
            <div key={c.period.start} className="card stack-sm">
              <div className="spread">
                <div className="grow">
                  <div className="item-title">
                    {c.current ? 'This paycheck' : describeDate(c.period.start, today)}
                  </div>
                  <div className="faint">
                    {c.period.paidBy.map((s) => s.name).join(', ')} · covers to {describeDate(c.period.end, today)}
                  </div>
                </div>
                <Amount text={formatMoney(c.period.incomeMinor, settings.currency)} blur={settings.blurAmounts} />
              </div>
              <div className="spread small">
                <span className="muted">Subscriptions due</span>
                <Amount text={`- ${formatMoney(c.billsMinor, settings.currency)}`} blur={settings.blurAmounts} />
              </div>
              <hr className="divider" />
              <div className="spread">
                <strong>Left for everything else</strong>
                <Amount text={formatMoney(c.leftoverMinor, settings.currency)} blur={settings.blurAmounts} />
              </div>
              {c.current && c.remainingMinor !== c.billsMinor && (
                <p className="faint">
                  <Amount text={formatMoney(c.remainingMinor, settings.currency)} blur={settings.blurAmounts} /> of
                  that has not gone out yet.
                </p>
              )}
              {c.leftoverMinor < 0 && (
                // Never hidden and never clamped to zero: a cheque that does not
                // cover its own bills is the most important thing this screen
                // could tell you. Stated in words, not shouted in red.
                <p className="notice">
                  This one does not cover its own subscriptions. Worth moving a charge date or cancelling
                  something before it lands.
                </p>
              )}
            </div>
          ))}
        </Section>
      )}

      {activeIncomes.length > 0 && (
        <Section title="Income against expenses">
          <div className="card stack-sm">
            <div className="spread">
              <span className="muted">Take-home each month</span>
              <Amount text={formatMoney(netMonthly, settings.currency)} blur={settings.blurAmounts} />            </div>
            <div className="spread">
              <span className="muted">Subscriptions each month</span>
              <Amount text={`- ${formatMoney(totalMonthlyMinor(subs), settings.currency)}`} blur={settings.blurAmounts} />
            </div>
            <hr className="divider" />
            <div className="spread">
              <strong>Left for everything else</strong>
              <Amount text={formatMoney(leftover, settings.currency)} blur={settings.blurAmounts} />
            </div>
            <p className="faint">
              This app only knows about subscriptions, so that remainder still has to cover rent, food and
              everything else. It is what is left over, not spare money.
            </p>
          </div>

          <div className="card stack-sm">
            <div className="spread">
              <span className="muted">You earn, a year</span>
              <Amount text={formatMoney(grossYearly, settings.currency)} blur={settings.blurAmounts} />
            </div>
            <div className="spread">
              <span className="muted">You keep</span>
              <Amount text={formatMoney(netYearly, settings.currency)} blur={settings.blurAmounts} />
            </div>
            <p className="faint">
              {grossYearly > 0
                ? `${Math.round(((grossYearly - netYearly) / grossYearly) * 100)}% comes out before you ever see it.`
                : ''}
            </p>
          </div>

          {deductionRows.length > 0 && (
            <div className="stack-sm">
              <h3 className="muted">What comes out, a year</h3>
              {deductionRows.map((row) => (
                <div key={row.label} className="stack-sm">
                  <div className="spread">
                    <span className="small">{row.label}</span>
                    <Amount text={formatMoney(row.minor, settings.currency)} blur={settings.blurAmounts} />
                  </div>
                  <div className="bar-track">
                    <div className="bar" style={{ width: `${Math.max(3, (row.minor / maxDeduction) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

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
          <p className="faint">{CALENDAR_ENTRY_STAYS}</p>
        </Section>
      )}

      {endedIncomes.length > 0 && (
        // The same as Cancelled, for income: kept rather than deleted, and
        // reachable, so "It's current again" is one tap away if a job comes back.
        <Section title="Ended">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShowEndedIncome((v) => !v)}>
            {showEndedIncome ? 'Hide' : 'Show'} {endedIncomes.length} ended
          </button>
          {showEndedIncome && (
            <div className="stack-sm">
              {endedIncomes.map((src) => (
                <div key={src.id} className="item">
                  <div className="grow">
                    <div className="item-title">{src.name}</div>
                    <div className="faint">Ended {describeDate(src.endedOn!, today)}</div>
                  </div>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditingIncome(src)}>
                    Edit
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="faint">Kept so the history is there, and so you can bring one back if it starts again.</p>
        </Section>
      )}
    </>
  );
}

/**
 * Said wherever a subscription is marked cancelled. A calendar entry added
 * from here lives in the phone's calendar, which Steady cannot reach, so it
 * keeps repeating until it is deleted there.
 */
const CALENDAR_ENTRY_STAYS =
  "If you put this in your phone's calendar, delete the repeating entry there - Steady can't reach your calendar.";

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
          <span>{describeBilling(sub)}</span>
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
        build={(options) => calendarForSubscription(sub, formatMoney(sub.amountMinor, sub.currency), Date.now(), options)}
        kind="subscription"
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
        <span>{describeBilling(sub)}</span>
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
            build={(options) =>
              calendarForSubscription(sub, formatMoney(sub.amountMinor, sub.currency), Date.now(), options)
            }
            kind="subscription"
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
          <p className="faint">{CALENDAR_ENTRY_STAYS}</p>
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
  /** Absent for a subscription that has not been saved yet: there is nothing to delete. */
  onDelete?: (sub: Subscription) => void;
}) {
  const [draft, setDraft] = useState(sub);
  const [amountText, setAmountText] = useState(sub.amountMinor ? (sub.amountMinor / 100).toFixed(2) : '');
  // Same reason as the amount: a box that rewrites itself as you type cannot be
  // cleared and retyped, because emptying it snaps straight back to 1.
  const [everyText, setEveryText] = useState(String(sub.every));
  /** The interval as a number, for matching presets while it is being typed. */
  const everyValue = Math.max(1, Math.floor(Number(everyText)) || 1);
  /*
    Which days a twice-a-month subscription charges on, held as raw text for the
    same reason. Kept even while another rhythm is selected, so switching to
    Monthly and back does not lose what you typed.
  */
  const [daysText, setDaysText] = useState(
    (sub.daysOfMonth?.length ? sub.daysOfMonth : DEFAULT_BILLING_DAYS).join(', '),
  );
  const parsedDays = daysText
    .split(',')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 31);
  const daysValue = normaliseDays(parsedDays, DEFAULT_BILLING_DAYS);
  const fixedDay = isFixedDayCycle(draft.cycle);
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

  /**
   * Typing keeps exactly what you typed. A known name only fills in what you
   * have not chosen yet - see whenNameTyped.
   */
  const onNameChange = (name: string) => patch(whenNameTyped({ ...draft, every: everyValue }, name));

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
        onSaved(
          await saveSubscription({
            ...draft,
            name: draft.name.trim(),
            amountMinor,
            // The two are exclusive: an interval has no days of the month, and
            // twice a month has no interval. Storing both would leave a stale
            // one to be read by mistake later.
            every: fixedDay ? 1 : everyValue,
            daysOfMonth: fixedDay ? daysValue : undefined,
          }),
        );
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
            autoComplete="off"
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
            autoComplete="off"
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
            const selected = findCyclePreset(draft.cycle, everyValue)?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={selected}
                className={`btn btn-sm${selected ? ' btn-primary' : ''}`}
                // A preset sets both fields, so picking one can never leave a
                // stale "every 2" behind from a previous choice.
                onClick={() => {
                  patch({ cycle: c.cycle });
                  setEveryText(String(c.every));
                }}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        {!findCyclePreset(draft.cycle, everyValue) && (
          <p className="faint">
            Currently {describeCycle(draft.cycle, everyValue, daysValue)}, which none of these cover. Picking
            one would change when it charges; leave them alone to keep it as it is.
          </p>
        )}
        <p className="faint">
          Every 2 weeks is 26 charges a year; twice a month is 24. They are not the same, and the difference
          is two whole charges.
        </p>
      </div>

      {fixedDay && (
        <div className="field">
          <label htmlFor="sub-days">Which days of the month?</label>
          <div className="btn-row">
            {BILLING_DAY_CHOICES.map((choice) => (
              <button
                key={choice.label}
                type="button"
                aria-pressed={String(daysValue) === String(choice.days)}
                className={`btn btn-sm${String(daysValue) === String(choice.days) ? ' btn-primary' : ''}`}
                onClick={() => setDaysText(choice.days.join(', '))}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <input
            autoComplete="off"
            id="sub-days"
            type="text"
            inputMode="numeric"
            value={daysText}
            onChange={(e) => setDaysText(e.target.value)}
            placeholder="1, 15"
            style={{ marginTop: 8 }}
          />
          <p className="faint">
            Charges {describeCycle(draft.cycle, everyValue, daysValue)}. Use 31 for the last day - it lands on
            the 28th in February and the 30th in April automatically.
          </p>
        </div>
      )}

      <div className="field">
        <label htmlFor="sub-first">{fixedDay ? 'Charging from' : 'Date of the next charge'}</label>
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
          autoComplete="off"
          id="sub-first"
          type="date"
          value={draft.firstBilled}
          onChange={(e) => patch({ firstBilled: e.target.value })}
        />
        <p className="faint">
          {describeDate(draft.firstBilled)}.{' '}
          {fixedDay
            ? 'The charges land on the days above; this only says when they start, so the first one is the first of those dates on or after it.'
            : 'Every future date is worked out from this one, so it only has to be right once.'}
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
            autoComplete="off"
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
              autoComplete="off"
              id="sub-cancel"
              value={draft.cancelHow}
              onChange={(e) => patch({ cancelHow: e.target.value })}
              placeholder="Account > Membership > Cancel. Or: ring 0800 123 4567, account number 12345."
            />
            <p className="faint">
              Write this down now, while you are already looking at it. Future you will not want to go hunting.
            </p>
          </div>

          {/* Twice a month has no interval to count, so the question is not asked. */}
          {!isFixedDayCycle(draft.cycle) && (
            <div className="field">
              <label htmlFor="sub-every">Bill every how many {cycleUnit(draft.cycle)}?</label>
              <input
                autoComplete="off"
                id="sub-every"
                type="number"
                min={1}
                max={24}
                value={everyText}
                onChange={(e) => setEveryText(e.target.value)}
              />
              <p className="faint">
                Only needed for a rhythm the buttons above do not cover, like every 2 months.
              </p>
            </div>
          )}

          <div className="field">
            <label htmlFor="sub-notes">Notes</label>
            <textarea
              autoComplete="off"
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
          <span className="small">
            Marked as cancelled on {describeDate(draft.endedOn)}. {CALENDAR_ENTRY_STAYS}
          </span>
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
        {onDelete && (
          <ConfirmButton
            label="Delete"
            confirmLabel="Yes, delete it"
            className="btn btn-quiet btn-sm"
            onConfirm={() => onDelete(draft)}
          />
        )}
      </div>
    </form>
  );
}
