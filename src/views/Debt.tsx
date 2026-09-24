import { Fragment, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankDebt, db, saveDebt } from '../db';
import type { DateKey, Debt, DebtPlan, IncomeSource, Settings, Subscription } from '../types';
import { balanceAfterPaymentMinor } from '../lib/debt';
import { markedPaidIn, paycheckRows, perCheckShareMinor, type CheckView, type PaymentRow } from '../lib/debtchecks';
import type { DebtPlanView, DebtSummary, ExtraReason } from '../lib/payoff';
import { whyNoPayPeriod } from '../lib/cashflow';
import { calendarForDebt, DEBT_CALENDAR_ENTRY_STAYS, DEBT_CALENDAR_FILENAME } from '../lib/ics';
import { formatMoney } from '../lib/money';
import { countOf, cutTitle, nameList } from '../lib/sections';
import {
  dueWords,
  extraBecause,
  monthYear,
  orderWhy,
  paidOffSummary,
  percentWords,
  promoWords,
  rateWords,
  spanWords,
  STRATEGY_LABELS,
  weekdayDate,
  wholeMoney,
} from '../lib/debtwords';
import { undoAction } from '../lib/undo';
import { daysBetween, shortDate, todayKey } from '../lib/time';
import AddToCalendar from '../components/AddToCalendar';
import DebtEditor, { BalanceForm, monthName, UpdateBalances } from '../components/DebtEditor';
import DebtPlanEditor, { StrategyButtons } from '../components/DebtPlanEditor';
import { useDebtPlan } from '../components/useDebtPlan';
import {
  Amount,
  ConfirmButton,
  DetailsButton,
  Empty,
  Section,
  useBackLayer,
  useNavigate,
  useToast,
} from '../components/ui';

const NO_SUBS: Subscription[] = [];
const NO_INCOMES: IncomeSource[] = [];

/** What changing a balance hands back: the number, its date, and whether it is now paid off. */
type BalanceChange = { balanceMinor: number; balanceAsOf: DateKey; paidOff: boolean };

type Money = (minor: number) => string;

/**
 * Debt, as a calm calculator and a plan.
 *
 * Paying debt off is a subject people carry a lot of shame about, so this
 * screen is built around what can be done next rather than how much there
 * is: the one large figure is what this paycheck puts toward debt, not the
 * total balance, and every number comes with the one sentence that explains
 * it. Nothing here is red, nothing is "late", and nothing is counted against
 * anyone.
 *
 * Every figure comes from buildDebtPlan, worked out once per render (see
 * useDebtPlan). The screen chooses words and lays out what comes back; it
 * does no sums of its own.
 *
 * Top to bottom, the same every time: Add a debt; This paycheck, which never
 * folds; the plan; the debts themselves; what is paid off; and how the
 * numbers are worked out.
 */
export default function DebtScreen({ settings }: { settings: Settings }) {
  const today = todayKey();
  const toast = useToast();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<{ debt: Debt; more: boolean } | null>(null);
  const [justSaved, setJustSaved] = useState<Debt | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);

  useBackLayer(editing !== null || justSaved !== null || planOpen || updatingAll, () => {
    setEditing(null);
    setJustSaved(null);
    setPlanOpen(false);
    setUpdatingAll(false);
  });

  const subs = useLiveQuery(() => db.subscriptions.toArray(), [settings.rev], NO_SUBS) ?? NO_SUBS;
  const incomes = useLiveQuery(() => db.incomes.toArray(), [settings.rev], NO_INCOMES) ?? NO_INCOMES;
  const { view, debts, plan } = useDebtPlan(settings, incomes, subs, today);

  const blur = settings.blurAmounts;
  const currency = settings.currency;
  const money: Money = (minor) => formatMoney(minor, currency);
  const summaryOf = (id: string) => view.debts.find((s) => s.debt.id === id);

  // The debts still being paid, in the order the plan works through them;
  // the ones not in the plan yet come after, by name.
  const rank = new Map(view.order.map((entry, i) => [entry.debtId, i]));
  const open = debts
    .filter((d) => !d.paidOffOn)
    .sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) || a.name.localeCompare(b.name));
  const paidOff = debts.filter((d) => d.paidOffOn).sort((a, b) => b.paidOffOn!.localeCompare(a.paidOffOn!));

  const startNew = () => {
    setJustSaved(null);
    setEditing({ debt: blankDebt({ currency }), more: false });
  };
  const edit = (debt: Debt, more = false) => setEditing({ debt, more });

  /** Changes one debt, says what happened, and offers to put it back exactly. */
  const change = async (debt: Debt, changes: Partial<Debt>, message: string) => {
    const before = (await db.debts.get(debt.id)) ?? debt;
    const after = await saveDebt({ ...before, ...changes });
    toast(message, undoAction(db.debts, [{ before, after }], toast));
  };
  const PAID_OFF_MESSAGE = "Marked as paid off. It's under Paid off now.";
  const markPaidOff = (debt: Debt) => void change(debt, { paidOffOn: today }, PAID_OFF_MESSAGE);
  const newBalance = (debt: Debt, c: BalanceChange) =>
    void change(
      debt,
      { balanceMinor: c.balanceMinor, balanceAsOf: c.balanceAsOf, ...(c.paidOff ? { paidOffOn: today } : {}) },
      c.paidOff ? PAID_OFF_MESSAGE : 'Balance updated.',
    );
  /** "Paid": one date and the balance after it. No record of the payment is kept. */
  const markPaid = (debt: Debt, dueOn: DateKey, c: BalanceChange) =>
    void change(
      debt,
      {
        paidThrough: dueOn,
        balanceMinor: c.balanceMinor,
        balanceAsOf: c.balanceAsOf,
        ...(c.paidOff ? { paidOffOn: today } : {}),
      },
      c.paidOff ? PAID_OFF_MESSAGE : 'Payment marked as paid.',
    );

  if (editing) {
    const saved = debts.some((d) => d.id === editing.debt.id);
    const before = editing.debt;
    return (
      <DebtEditor
        debt={editing.debt}
        existing={saved}
        blurAmounts={blur}
        openMore={editing.more}
        onSaved={(after) => {
          setEditing(null);
          if (!saved) {
            setJustSaved(after);
            return;
          }
          const message =
            !before.paidOffOn && after.paidOffOn
              ? PAID_OFF_MESSAGE
              : before.paidOffOn && !after.paidOffOn
                ? "It's back under Your debts."
                : 'Saved.';
          toast(message, undoAction(db.debts, [{ before, after }], toast));
        }}
        onCancel={() => setEditing(null)}
        onDelete={
          saved
            ? async (d) => {
                setEditing(null);
                const stored = await db.debts.get(d.id);
                await db.debts.delete(d.id);
                if (stored) toast('Deleted.', undoAction(db.debts, [{ before: stored, after: undefined }], toast));
              }
            : undefined
        }
      />
    );
  }

  if (planOpen) {
    return (
      <DebtPlanEditor
        plan={plan}
        debts={debts}
        incomes={incomes}
        subs={subs}
        currency={currency}
        blurAmounts={blur}
        onSaved={() => setPlanOpen(false)}
        onCancel={() => setPlanOpen(false)}
        onOpenMoney={() => {
          setPlanOpen(false);
          navigate('money');
        }}
      />
    );
  }

  if (updatingAll) {
    return (
      <UpdateBalances
        debts={open}
        blurAmounts={blur}
        onSaved={(pairs) => {
          setUpdatingAll(false);
          if (pairs.length === 0) toast('Nothing changed.');
          else toast(pairs.length === 1 ? 'Balance updated.' : 'Balances updated.', undoAction(db.debts, pairs, toast));
        }}
        onCancel={() => setUpdatingAll(false)}
      />
    );
  }

  if (justSaved) {
    return (
      <SavedPanel
        debt={debts.find((d) => d.id === justSaved.id) ?? justSaved}
        summary={summaryOf(justSaved.id)}
        currency={currency}
        blur={blur}
        onDone={() => setJustSaved(null)}
        onAddAnother={startNew}
        onChange={() => {
          const latest = debts.find((d) => d.id === justSaved.id) ?? justSaved;
          setJustSaved(null);
          edit(latest, true);
        }}
      />
    );
  }

  /*
    One line for each section while it is closed. With amounts blurred the
    line leaves the amount out rather than blurring it, because a tappable
    blurred amount cannot sit inside the button that opens the section.
  */
  const strategy = STRATEGY_LABELS[view.strategy];
  const planSummary =
    view.planned.length === 0
      ? 'Appears once a debt has a balance and a due date'
      : view.result.status === 'paidOff' && view.result.paidOffOn
        ? `${strategy} · all paid off by ${monthYear(view.result.paidOffOn)}`
        : view.result.status === 'stuck'
          ? `${strategy} · the balances don't go down at this amount`
          : `${strategy} · more than 50 years at this amount`;
  const o = view.open;
  const listSummary =
    o.count === 0
      ? 'Nothing added yet'
      : blur || o.otherCurrency > 0
        ? countOf(o.count, 'debt', 'debts')
        : `${countOf(o.count, 'debt', 'debts')}, ${money(o.totalMinor)}${o.asOf ? ` as of ${shortDate(o.asOf, today)}` : ''}`;

  return (
    <>
      {/* The one thing you come here to add, where it is never hunted for. */}
      <div className="btn-row btn-row-fill">
        <button type="button" className="btn btn-primary" onClick={startNew}>
          Add a debt
        </button>
      </div>

      {/* What you came for, so it never folds. */}
      <Section title="This paycheck">
        <ThisPaycheck
          view={view}
          open={open}
          incomes={incomes}
          today={today}
          blur={blur}
          money={money}
          onChooseAmount={() => setPlanOpen(true)}
          onPaid={markPaid}
        />
      </Section>

      <Section title="The plan" collapsible="debt.plan" summary={planSummary}>
        <ThePlan
          view={view}
          plan={plan}
          incomes={incomes}
          currency={currency}
          today={today}
          blur={blur}
          money={money}
          onChooseAmount={() => setPlanOpen(true)}
          onEdit={(debt) => edit(debt)}
        />
      </Section>

      <Section title="Your debts" collapsible="debt.list" summary={listSummary}>
        {open.length === 0 ? (
          <Empty>
            Anything you're paying back: a credit card, a loan, a line of credit, buy now pay later, money a friend
            lent you. Type the numbers from your statement or app. Nothing is looked up, and nothing leaves this phone.
          </Empty>
        ) : (
          <>
            {open.length > 1 && (
              <div className="btn-row">
                <button type="button" className="btn btn-sm" onClick={() => setUpdatingAll(true)}>
                  Update balances
                </button>
              </div>
            )}
            <div className="stack-sm">
              {open.map((debt) => (
                <DebtCard
                  key={debt.id}
                  debt={debt}
                  summary={summaryOf(debt.id)}
                  currency={currency}
                  today={today}
                  blur={blur}
                  onEdit={() => edit(debt)}
                  onNewBalance={(c) => newBalance(debt, c)}
                  onPaidOff={() => markPaidOff(debt)}
                />
              ))}
            </div>
          </>
        )}
      </Section>

      {paidOff.length > 0 && (
        <Section title="Paid off" collapsible="debt.paidOff" summary={paidOffSummary(paidOff)}>
          {/* Quiet on purpose: no counts, no "it took you X months", nothing
              to live up to next time. */}
          <div className="stack-sm">
            {paidOff.map((debt) => (
              <div key={debt.id} className="item">
                <div className="grow">
                  <div className="item-title">{debt.name}</div>
                  <div className="faint">Paid off in {monthYear(debt.paidOffOn!)}</div>
                </div>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => edit(debt)}>
                  Edit
                </button>
              </div>
            ))}
          </div>
          <p className="faint">Kept so you can look back at it, and bring it back if you use it again.</p>
          <p className="faint">{DEBT_CALENDAR_ENTRY_STAYS}</p>
        </Section>
      )}

      <Section title="How this works" collapsible="debt.howItWorks" summary="How the dates and amounts are worked out">
        <ul className="plain-list stack-sm small">
          <li>
            Interest is worked out a month at a time: the balance times the APR, divided by 12, to the cent. Card
            companies use a daily rate, so your statements will differ a little.
          </li>
          <li>
            Each month every debt gets its minimum first. What's left of the amount you chose - the extra - goes to one
            debt at a time: the highest rate first, or the smallest balance first, whichever you picked.
          </li>
          <li>
            When a debt is paid off, what went to it moves to the next one, so the total you put in stays the same.
            That is what brings the dates closer.
          </li>
          <li>
            Card minimums are worked out the way most statements do it - a share of the balance plus the month's
            interest - and rounded up to the dollar. Other minimums stay at what you typed.
          </li>
          <li>
            A promo rate is used until its end date. One that adds the interest back if it isn't paid in full is paced
            to be cleared a payment early, whichever order you picked.
          </li>
          <li>
            Each payment comes from the last paycheck that arrives before its due date. One due on a payday comes from
            the check before, because money that lands that morning may not be there in time.
          </li>
          <li>
            The suggestion is the minimums, plus half of what's left after subscriptions and your estimate for
            everything else. The other half stays with you for surprises.
          </li>
          <li>New spending on a card isn't counted. Nothing is looked up, and nothing leaves this phone.</li>
        </ul>
      </Section>
    </>
  );
}

/* ---------------------------------------------------------------------------
   This paycheck
   -------------------------------------------------------------------------- */

/**
 * A label, an optional line under it, and its figure on the right, as on
 * Money. `anchor` sets the figure large: the screen's one big number.
 */
function FigureRow({
  label,
  detail,
  amount,
  blur,
  anchor = false,
}: {
  label: string;
  detail?: ReactNode;
  amount: string;
  blur: boolean;
  anchor?: boolean;
}) {
  return (
    <div className="figure">
      <div>
        <div className="item-title">{label}</div>
        {detail && <div className="faint">{detail}</div>}
      </div>
      <Amount className={anchor ? 'figure-value amount-key' : 'figure-value'} text={amount} blur={blur} />
    </div>
  );
}

function ThisPaycheck({
  view,
  open,
  incomes,
  today,
  blur,
  money,
  onChooseAmount,
  onPaid,
}: {
  view: DebtPlanView;
  open: Debt[];
  incomes: IncomeSource[];
  today: DateKey;
  blur: boolean;
  money: Money;
  onChooseAmount: () => void;
  onPaid: (debt: Debt, dueOn: DateKey, change: BalanceChange) => void;
}) {
  const navigate = useNavigate();
  if (open.length === 0) {
    return <Empty>Once you add a debt, this shows what each paycheck needs to cover, and where any extra could go.</Empty>;
  }
  if (view.planned.length === 0) {
    return <Empty>This fills in once a debt has a balance and its next due date.</Empty>;
  }

  const chosen = view.budgetSource !== 'minimums';
  const amountButton = (
    <button type="button" className="btn btn-sm" onClick={onChooseAmount}>
      {chosen ? 'Change the amount' : 'Choose an amount'}
    </button>
  );

  const [check, ...later] = view.checks;
  if (!check) {
    // No payday can be placed, so there is no check to lay the payments over:
    // the plan's next month stands in for it.
    const why = whyNoPayPeriod(incomes, today);
    return (
      <div className="card stack-sm">
        <FigureRow
          anchor
          label="This month"
          detail="The next payment on each debt"
          amount={money(view.month.totalMinor)}
          blur={blur}
        />
        <PaymentLines rows={view.month.rows} today={today} blur={blur} money={money} onPaid={onPaid} />
        <hr className="divider" />
        <WhyExtra extras={view.month.extras} today={today} chosen={chosen} />
        <p className="faint">
          {why.kind === 'needsRecentPayday'
            ? `Add a recent payday to ${why.source.name} on the Money tab and this will line payments up with your paychecks. For now it shows this month.`
            : why.kind === 'noIncome'
              ? 'Add your income on the Money tab and this will line payments up with your paychecks. For now it shows this month.'
              : "Paydays can't be worked out from your income yet, so for now this shows this month."}
        </p>
        <div className="btn-row">
          {amountButton}
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => navigate('money')}>
            Open Money
          </button>
        </div>
      </div>
    );
  }

  const rows = paycheckRows(check);
  const marked = markedPaidIn(open, check.period);
  const days = daysBetween(check.period.start, check.period.end) + 1;

  return (
    <>
      <div className="card stack-sm">
        <FigureRow
          anchor
          label={check.current ? 'From this paycheck' : 'From your next paycheck'}
          detail={
            <>
              {check.period.paidBy.map((s) => s.name).join(', ')}, <span className="nowrap">{shortDate(check.period.start, today)}</span>{' '}
              · covers to <span className="nowrap">{shortDate(check.period.end, today)}</span>
            </>
          }
          amount={money(check.towardDebtMinor)}
          blur={blur}
        />
        {rows.length > 0 ? (
          <PaymentLines rows={rows} today={today} blur={blur} money={money} onPaid={onPaid} />
        ) : (
          <p className="faint">Nothing is due before your next check.</p>
        )}
        {check.keepForLaterMinor > 0 && (
          <p className="faint">
            Keep <Amount text={money(check.keepForLaterMinor)} blur={blur} /> of it for the payments due{' '}
            {nameList(check.keepFor.map((d) => shortDate(d, today)))}: the check before them can't cover them alone.
          </p>
        )}
        {check.usesKeptMinor > 0 && (
          <p className="faint">
            Uses the <Amount text={money(check.usesKeptMinor)} blur={blur} /> kept from the last check.
          </p>
        )}
        {marked.length > 0 && (
          <p className="faint">
            Marked as paid: {marked.map((d) => `${d.name} (${shortDate(d.paidThrough!, today)})`).join(', ')}.
          </p>
        )}
        {check.short?.overIncomeMinor ? (
          // Said in words, never in red, and never as something done wrong.
          <p className="notice">
            The payments due before your next check come to more than this check brings in after subscriptions. Many
            lenders will move a due date if you ask.
          </p>
        ) : check.short?.overTargetMinor ? (
          <p className="notice">
            The payments due before your next check come to more than the amount you chose, so this check puts in{' '}
            <Amount text={money(check.short.overTargetMinor)} blur={blur} /> more.
          </p>
        ) : null}
        {check.staysMinor > 0 && (
          <p className="faint">
            The plan is nearly done, so <Amount text={money(check.staysMinor)} blur={blur} /> of your amount stays with
            you.
          </p>
        )}
        <hr className="divider" />
        <WhyExtra extras={check.extra} today={today} chosen={chosen} />
        <FigureRow
          label={check.current ? 'Left from this paycheck' : 'Left from that paycheck'}
          amount={money(check.leftMinor)}
          blur={blur}
        />
        <p className="faint">After subscriptions and these payments. Rent, food and everything else come out of this.</p>
        {check.leftBelowEstimate && (
          <p className="faint">
            That's less than your estimate for everything else over these {days} days
            {incomes.length > 1 ? ': the bigger checks cover the rest.' : '.'}
          </p>
        )}
        <div className="btn-row">
          {amountButton}
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => navigate('money')}>
            See this paycheck on Money
          </button>
        </div>
      </div>

      {later.length > 0 && <LaterChecks checks={later} today={today} blur={blur} money={money} />}
    </>
  );
}

/**
 * The one sentence per debt that gets extra, in the order the plan gives it:
 * "The extra goes to Visa, because ...", then "The rest goes to ...".
 */
function WhyExtra({
  extras,
  today,
  chosen,
}: {
  extras: { debt: Debt; reason: ExtraReason }[];
  today: DateKey;
  chosen: boolean;
}) {
  if (extras.length > 0) {
    return (
      <>
        {extras.map((e, i) => (
          <p key={e.debt.id} className="small">
            {i === 0 ? 'The extra goes to' : 'The rest goes to'} {e.debt.name}, because{' '}
            {extraBecause(e.reason, e.debt, today, i > 0)}.
          </p>
        ))}
      </>
    );
  }
  if (chosen) return null;
  return (
    <p className="faint">
      No extra amount yet. Anything above the minimums goes to one debt at a time, which is what brings the dates
      closer.
    </p>
  );
}

function PaymentLines({
  rows,
  today,
  blur,
  money,
  onPaid,
}: {
  rows: PaymentRow[];
  today: DateKey;
  blur: boolean;
  money: Money;
  onPaid: (debt: Debt, dueOn: DateKey, change: BalanceChange) => void;
}) {
  return (
    <div className="stack">
      {rows.map((row) => (
        <PaymentLine
          key={`${row.debt.id}-${row.dueOn ?? 'extra'}`}
          row={row}
          today={today}
          blur={blur}
          money={money}
          onPaid={onPaid}
        />
      ))}
    </div>
  );
}

/**
 * One payment: the debt, when, how it is made up, and the amount. A due date
 * is "by Mon, Oct 12" - never "in 3 days", and never anything about a date
 * that has gone by.
 */
function PaymentLine({
  row,
  today,
  blur,
  money,
  onPaid,
}: {
  row: PaymentRow;
  today: DateKey;
  blur: boolean;
  money: Money;
  onPaid: (debt: Debt, dueOn: DateKey, change: BalanceChange) => void;
}) {
  const [paying, setPaying] = useState(false);
  const due =
    row.dueOn === null
      ? null
      : row.dueOn === today
        ? 'due today'
        : row.dueOn < today
          ? weekdayDate(row.dueOn, today)
          : `by ${weekdayDate(row.dueOn, today)}`;
  const makeUp =
    row.minimumMinor > 0 && row.extraMinor > 0 ? (
      <>
        <Amount text={money(row.minimumMinor)} blur={blur} /> minimum + <Amount text={money(row.extraMinor)} blur={blur} />{' '}
        extra
      </>
    ) : row.extraMinor > 0 ? (
      'extra'
    ) : (
      'minimum'
    );

  return (
    <div className="stack-sm">
      <div className="figure">
        <span className="item-title">{row.debt.name}</span>
        <Amount className="figure-value" text={money(row.totalMinor)} blur={blur} />
      </div>
      <div className="item-foot">
        <div className="stack-sm">
          <div className="meta">
            {due && <span className="nowrap">{due}</span>}
            <span>{makeUp}</span>
            {/* Autopay pays the minimum; the extra is still yours to send. */}
            {row.autopay && row.minimumMinor > 0 && (
              <span>{row.extraMinor > 0 ? 'minimum on autopay' : 'autopay'}</span>
            )}
          </div>
        </div>
        {row.dueOn && !paying && (
          <button type="button" className="btn btn-quiet btn-sm details-btn" onClick={() => setPaying(true)}>
            Paid<span className="sr-only"> - {row.debt.name}</span>
          </button>
        )}
      </div>
      {paying && row.dueOn && (
        <BalanceForm
          debt={row.debt}
          label="Balance now?"
          startMinor={balanceAfterPaymentMinor(row.debt, row.dueOn, row.totalMinor)}
          hint="What Steady expects is left after this payment. If your statement or app shows a different number, type that."
          onSave={(c) => {
            setPaying(false);
            onPaid(row.debt, row.dueOn!, c);
          }}
          onCancel={() => setPaying(false)}
        />
      )}
    </div>
  );
}

/** The checks after this one, a row each: when, what is due, and what it puts toward debt. */
function LaterChecks({ checks, today, blur, money }: { checks: CheckView[]; today: DateKey; blur: boolean; money: Money }) {
  return (
    <div className="stack-sm">
      <h3>The next ones</h3>
      <div className="card card-rows">
        {checks.map((c, i) => {
          const due = [...new Set(c.minimums.map((m) => cutTitle(m.debt.name)))];
          return (
            <Fragment key={c.period.start}>
              {i > 0 && <hr className="divider" />}
              <div className="figure">
                <div>
                  <div className="item-title">
                    <span className="nowrap">{shortDate(c.period.start, today)}</span> · covers to{' '}
                    <span className="nowrap">{shortDate(c.period.end, today)}</span>
                  </div>
                  <div className="meta">
                    {due.length > 0 && <span>{nameList(due)} due</span>}
                    {c.extraMinor > 0 && (
                      <span>
                        <Amount text={money(c.extraMinor)} blur={blur} /> extra
                      </span>
                    )}
                    {due.length === 0 && c.extraMinor === 0 && <span>nothing due</span>}
                  </div>
                </div>
                <Amount className="figure-value" text={money(c.towardDebtMinor)} blur={blur} />
              </div>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   The plan
   -------------------------------------------------------------------------- */

function ThePlan({
  view,
  plan,
  incomes,
  currency,
  today,
  blur,
  money,
  onChooseAmount,
  onEdit,
}: {
  view: DebtPlanView;
  plan: DebtPlan;
  incomes: IncomeSource[];
  currency: string;
  today: DateKey;
  blur: boolean;
  money: Money;
  onChooseAmount: () => void;
  onEdit: (debt: Debt) => void;
}) {
  const notPlanned = view.debts.filter((s) => s.notPlanned === 'noSchedule' || s.notPlanned === 'otherCurrency');
  const notPlannedLines = notPlanned.map((s) => (
    <div key={s.debt.id} className="spread">
      <span className="faint grow">
        {s.notPlanned === 'noSchedule'
          ? `${s.debt.name} isn't in the plan yet: it needs its next due date.`
          : `${s.debt.name} isn't in the plan: it's in ${s.debt.currency}, and the plan is in ${currency}.`}
      </span>
      {s.notPlanned === 'noSchedule' && (
        <button type="button" className="btn btn-sm" onClick={() => onEdit(s.debt)}>
          Add it
        </button>
      )}
    </div>
  ));

  if (view.planned.length === 0) {
    return (
      <>
        <Empty>The plan appears here once a debt has a balance and its next due date.</Empty>
        {notPlannedLines}
      </>
    );
  }

  const r = view.result;
  const c = view.comparison;
  const planned = view.debts.filter((s) => s.notPlanned === null);
  const nameOf = (id: string) => view.planned.find((d) => d.id === id)?.name ?? '';
  const whole = (minor: number) => wholeMoney(minor, currency);
  const chosen = view.budgetSource !== 'minimums';
  const perCheck = view.checks.length > 0 || view.budgetSource === 'perCheck';
  const perCheckShare = c.makeProgressMinor !== null ? Object.values(perCheckShareMinor(c.makeProgressMinor, incomes, today)) : [];

  return (
    <>
      <div className="card stack-sm">
        {r.status === 'paidOff' && r.paidOffOn ? (
          <>
            <p className="plan-lead">
              All paid off by <strong>{monthYear(r.paidOffOn, true)}</strong>
            </p>
            {c.saved && c.saved.interestMinor > 0 && (
              <p className="small">
                About <Amount text={whole(c.saved.interestMinor)} blur={blur} /> less interest than paying only the
                minimums{c.saved.months > 0 ? `, and ${spanWords(c.saved.months)} sooner` : ''}.
                {/* With nothing chosen the plan still beats "only the minimums":
                    card minimums shrink as balances do, and the plan keeps
                    today's total instead. Said, so the two dates don't seem
                    to disagree. */}
                {!chosen && " That's from keeping today's minimums total the same, so each finished debt's payment moves to the next."}
              </p>
            )}
            {!chosen && (
              <p className="small">
                {perCheck ? 'More from each check brings the date closer.' : 'More each month brings the date closer.'}
              </p>
            )}
            {r.totalInterestMinor > 0 && (
              <p className="faint">
                About <Amount text={whole(r.totalInterestMinor)} blur={blur} /> in interest along the way.
              </p>
            )}
          </>
        ) : r.status === 'stuck' ? (
          <>
            <p className="plan-lead">At this amount, the balances don't go down.</p>
            <p className="small">
              The payments about match the interest.
              {c.makeProgressMinor !== null && (
                <>
                  {' '}
                  From about <Amount text={money(c.makeProgressMinor)} blur={blur} /> a month
                  {perCheckShare.length === 1 && (
                    <>
                      {' '}
                      (about <Amount text={money(perCheckShare[0])} blur={blur} /> a check)
                    </>
                  )}{' '}
                  they start to shrink.
                </>
              )}
            </p>
          </>
        ) : (
          <>
            <p className="plan-lead">At this amount it would take more than 50 years.</p>
            <p className="small">A bigger amount will show a date.</p>
          </>
        )}
        {r.status !== 'paidOff' && view.finishIn3YearsMinor !== null && (
          <p className="small">
            To be done in 3 years: about <Amount text={money(view.finishIn3YearsMinor)} blur={blur} /> a month.
          </p>
        )}
        {r.minimumsAboveBudgetOn && chosen && (
          <p className="faint">
            In {monthYear(r.minimumsAboveBudgetOn, true)} the minimums add up to more than your plan, so the plan pays
            the minimums that month.
          </p>
        )}
        {c.promoWarnings.map((w) => (
          <p key={w.debtId} className="notice">
            At this plan, <Amount text={money(w.leftMinor)} blur={blur} /> would still be on {nameOf(w.debtId)}'s promo
            when it ends {shortDate(w.endsOn, today)}, and about <Amount text={whole(w.chargeMinor)} blur={blur} /> of
            held-back interest would be added. About <Amount text={money(w.neededMonthlyMinor)} blur={blur} /> a month
            to this card clears it in time.
          </p>
        ))}
      </div>

      <div className="stack-sm">
        <h3>Which debt gets the extra</h3>
        <StrategyButtons strategy={view.strategy} />
        {c.strategyDelta && c.other.paidOffOn && (
          <p className="faint">
            {c.strategyDelta.aboutTheSame ? (
              'The other order costs about the same here, so pick whichever feels better.'
            ) : (
              <>
                The other order would finish in {monthYear(c.other.paidOffOn)}, with about{' '}
                <Amount text={whole(Math.abs(c.strategyDelta.interestMinor))} blur={blur} />{' '}
                {c.strategyDelta.interestMinor > 0 ? 'more' : 'less'} interest.
              </>
            )}
          </p>
        )}
        {view.planned.some((d) => d.promo?.deferred) && c.promoWarnings.length === 0 && (
          <p className="faint">
            Promo balances that would add back interest are always cleared in time first, whichever you pick.
          </p>
        )}
      </div>

      <div className="stack-sm">
        <h3>{perCheck ? 'Toward debt from each check' : 'Toward debt each month'}</h3>
        {view.budgetSource === 'perCheck' &&
          incomes
            .filter((s) => plan.perCheckMinor?.[s.id] !== undefined && (view.checksPerYear[s.id] ?? 0) > 0)
            .map((s, _, all) => (
              <div key={s.id} className="figure">
                <span>{all.length === 1 ? 'From each check' : `From each ${s.name} check`}</span>
                <Amount className="figure-value" text={money(plan.perCheckMinor![s.id])} blur={blur} />
              </div>
            ))}
        {view.budgetSource === 'perMonth' && (
          <div className="figure">
            <span>Each month</span>
            <Amount className="figure-value" text={money(view.budgetMinor)} blur={blur} />
          </div>
        )}
        {view.budgetSource === 'minimums' && (
          <p className="faint">
            None chosen yet, so the plan keeps paying today's minimums: about{' '}
            <Amount text={money(view.budgetMinor)} blur={blur} /> a month.
          </p>
        )}
        <p className="faint">
          When a debt is paid off, what went to it moves to the next one, so the total stays the same.
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn-sm" onClick={onChooseAmount}>
            {chosen ? 'Change the amount' : 'Choose an amount'}
          </button>
        </div>
      </div>

      <div className="stack-sm">
        <h3>When each one is paid off</h3>
        <div className="card card-rows">
          {view.order.map((entry, i) => {
            const debt = view.planned.find((d) => d.id === entry.debtId)!;
            return (
              <Fragment key={entry.debtId}>
                {i > 0 && <hr className="divider" />}
                <div className="stack-sm">
                  <div className="figure">
                    <span className="item-title">{debt.name}</span>
                    <span className="figure-value">
                      {entry.paidOffOn ? `paid off ${monthYear(entry.paidOffOn)}` : 'not at this amount'}
                    </span>
                  </div>
                  <p className="faint">
                    {orderWhy(entry, debt, nameOf, today, !c.promoWarnings.some((w) => w.debtId === entry.debtId))}
                  </p>
                </div>
              </Fragment>
            );
          })}
        </div>
      </div>

      {notPlannedLines}
      {planned
        .filter((s) => s.missingRate)
        .map((s) => (
          <div key={s.debt.id} className="spread">
            <span className="faint grow">
              {s.debt.name} doesn't have a rate yet, so its interest isn't counted. Add it from your statement when you
              can.
            </span>
            <button type="button" className="btn btn-sm" onClick={() => onEdit(s.debt)}>
              Add it
            </button>
          </div>
        ))}
      {planned.some((s) => s.stale) && (
        <p className="faint">Some balances are more than a month old, so these dates are rougher than usual.</p>
      )}

      {/* Said once, here, plainly - not as a scary disclaimer. */}
      <p className="faint">
        Steady is a calculator, not financial advice. It works from the numbers you typed, and assumes rates and
        minimums stay the same.
      </p>
    </>
  );
}

/* ---------------------------------------------------------------------------
   One debt
   -------------------------------------------------------------------------- */

/** The payment the calendar entry can name: a set amount only, since a card's minimum changes every month. */
function setAmountLabel(debt: Debt): string | null {
  return debt.minimum.kind === 'fixed' && debt.minimum.amountMinor > 0
    ? formatMoney(debt.minimum.amountMinor, debt.currency)
    : null;
}

function DebtCard({
  debt,
  summary,
  currency,
  today,
  blur,
  onEdit,
  onNewBalance,
  onPaidOff,
}: {
  debt: Debt;
  summary: DebtSummary | undefined;
  currency: string;
  today: DateKey;
  blur: boolean;
  onEdit: () => void;
  onNewBalance: (change: BalanceChange) => void;
  onPaidOff: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const detailsId = `debt-details-${debt.id}`;
  const money: Money = (minor) => formatMoney(minor, debt.currency);
  const own = summary?.minimumsOnly ?? null;
  const inPlan = summary?.plan ?? null;

  const where =
    summary?.notPlanned === 'noSchedule'
      ? 'Not in the plan yet: it needs its next due date'
      : summary?.notPlanned === 'otherCurrency'
        ? `Not in the plan: it's in ${debt.currency}, and the plan is in ${currency}`
        : summary?.notPlanned === 'zeroBalance'
          ? 'Nothing left on it'
          : inPlan?.paidOffOn
            ? `Paid off by ${monthYear(inPlan.paidOffOn)}`
            : inPlan
              ? 'Not paid off at this amount'
              : '';

  const updateForm = (
    <BalanceForm
      debt={debt}
      label="New balance"
      hint="From your latest statement or app."
      askDate
      onSave={(c) => {
        setUpdating(false);
        onNewBalance(c);
      }}
      onCancel={() => setUpdating(false)}
    />
  );

  return (
    <div className="card card-tight stack-sm">
      <div className="figure">
        <button
          type="button"
          className="item-title item-title-btn"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((v) => !v)}
        >
          {debt.name}
        </button>
        <Amount className="figure-value" text={money(debt.balanceMinor)} blur={blur} />
      </div>
      <div className="item-foot">
        <div className="stack-sm">
          <div className="meta">
            <span>{rateWords(debt)}</span>
            {summary?.next && summary.next.minimumMinor > 0 && (
              <span>
                <Amount text={money(summary.next.minimumMinor)} blur={blur} /> minimum
              </span>
            )}
            <span>{dueWords(debt)}</span>
            <span className="nowrap">as of {shortDate(debt.balanceAsOf, today)}</span>
            {debt.autopay && <span>autopay</span>}
          </div>
          {where && <div className="faint">{where}</div>}
        </div>
        <DetailsButton open={open} onToggle={() => setOpen((v) => !v)} controls={detailsId} />
      </div>

      {summary?.stale && !updating && (
        <div className="spread">
          <span className="faint grow">Update it when you next see a statement.</span>
          <button type="button" className="btn btn-sm" onClick={() => setUpdating(true)}>
            Update balance
          </button>
        </div>
      )}
      {summary?.notPlanned === 'zeroBalance' && (
        <div className="spread">
          <span className="faint grow">Its balance is zero. Move it to Paid off?</span>
          <ConfirmButton label="Move it to Paid off" confirmLabel="Yes, it's paid off" className="btn btn-sm" onConfirm={onPaidOff} />
        </div>
      )}
      {summary?.noSetPayment ? (
        <p className="faint">No set payment, so it's paid from the extra in your plan.</p>
      ) : (
        summary?.growsAtMinimum &&
        summary.paymentToShrinkMinor !== null && (
          <p className="faint">
            At its minimum alone, this balance wouldn't come down, because its interest is about{' '}
            <Amount text={money(summary.interestNowMinor)} blur={blur} /> a month. Paying{' '}
            <Amount text={money(summary.paymentToShrinkMinor)} blur={blur} /> or more a month brings it down.
          </p>
        )
      )}
      {!open && updating && updateForm}

      {open && (
        <div id={detailsId} className="stack-sm">
          {summary && summary.interestNowMinor > 0 && (
            <div className="figure small">
              <span className="muted">Interest right now</span>
              <span className="figure-value">
                about <Amount text={money(summary.interestNowMinor)} blur={blur} /> a month
              </span>
            </div>
          )}
          {own && (
            <div className="figure small">
              <span className="muted">On its own, at the minimum</span>
              <span className="figure-value">{own.paidOffOn ? `paid off by ${monthYear(own.paidOffOn)}` : 'not paid off'}</span>
            </div>
          )}
          <div className="figure small">
            <span className="muted">Minimum</span>
            <span className="figure-value">
              <MinimumWords debt={debt} money={money} blur={blur} />
            </span>
          </div>
          {debt.creditLimitMinor !== undefined && (
            <div className="figure small">
              <span className="muted">Credit limit</span>
              <Amount className="figure-value" text={money(debt.creditLimitMinor)} blur={blur} />
            </div>
          )}
          {debt.promo && (
            <p className="small">
              {promoWords(debt, today)}.
              {debt.promo.deferred && ' If any of the promo part is left then, the interest held back is added.'}
              {inPlan?.promoClearedOn && ` On your plan, the promo part is cleared by ${monthYear(inPlan.promoClearedOn)}.`}
            </p>
          )}
          {debt.fee && (
            <div className="figure small">
              <span className="muted">{debt.fee.every === 'month' ? 'Monthly fee' : 'Annual fee'}</span>
              <span className="figure-value">
                <Amount text={money(debt.fee.amountMinor)} blur={blur} />
                {debt.fee.every === 'year' && debt.fee.month !== undefined ? ` in ${monthName(debt.fee.month)}` : ''}
              </span>
            </div>
          )}
          {summary?.scheduledEndOn && (
            <p className="small">
              Scheduled to finish in {monthYear(summary.scheduledEndOn)}.
              {summary.pastTerm &&
                " That date has passed and it's still being paid, which deferments and changed payments do. The plan works from the balance and the payment."}
            </p>
          )}
          {summary?.missingRate && (
            <p className="faint">No rate yet, so its interest isn't counted. Add it from your statement when you can.</p>
          )}
          {debt.notes.trim() && <p className="note-body">{debt.notes}</p>}
          <AddToCalendar
            build={(options) => calendarForDebt(debt, setAmountLabel(debt), Date.now(), options)}
            kind="debt"
            filename={DEBT_CALENDAR_FILENAME}
            nothingToAdd="It needs a balance and its next due date before there is anything to put in a calendar."
          />
          {updating ? (
            updateForm
          ) : (
            <div className="btn-row">
              <button type="button" className="btn btn-sm" onClick={() => setUpdating(true)}>
                Update balance
              </button>
              <button type="button" className="btn btn-sm" onClick={onEdit}>
                Edit
              </button>
              <ConfirmButton
                label="Mark as paid off"
                confirmLabel="Yes, it's paid off"
                className="btn btn-quiet btn-sm"
                onConfirm={onPaidOff}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** "1% of the balance plus interest, at least $35", with the amount blurred when amounts are. */
function MinimumWords({ debt, money, blur }: { debt: Debt; money: Money; blur: boolean }) {
  const rule = debt.minimum;
  if (rule.kind === 'fixed') {
    return rule.amountMinor > 0 ? (
      <>
        <Amount text={money(rule.amountMinor)} blur={blur} /> each time
      </>
    ) : (
      <>no set amount</>
    );
  }
  if (rule.kind === 'percentPlusInterest' && rule.percent === 0 && rule.floorMinor === 0) return <>the interest only</>;
  const share =
    rule.kind === 'percentPlusInterest'
      ? `${percentWords(rule.percent)} plus interest`
      : `${percentWords(rule.percent)} of the balance`;
  return rule.floorMinor > 0 ? (
    <>
      {share}, at least <Amount text={money(rule.floorMinor)} blur={blur} />
    </>
  ) : (
    <>{share}</>
  );
}

/* ---------------------------------------------------------------------------
   After saving a new one
   -------------------------------------------------------------------------- */

/**
 * The screen straight after adding a debt: when it is paid off on its own at
 * the minimum, and when on the plan - the difference is the reason to have a
 * plan at all - and the calendar step, while you are thinking about it.
 */
function SavedPanel({
  debt,
  summary,
  currency,
  blur,
  onDone,
  onAddAnother,
  onChange,
}: {
  debt: Debt;
  summary: DebtSummary | undefined;
  currency: string;
  blur: boolean;
  onDone: () => void;
  onAddAnother: () => void;
  onChange: () => void;
}) {
  const own = summary?.minimumsOnly ?? null;
  const inPlan = summary?.plan ?? null;
  return (
    <Section title={`${debt.name} is saved`}>
      <div className="card stack-sm">
        <div className="figure">
          <span className="muted">Balance</span>
          <Amount className="figure-value" text={formatMoney(debt.balanceMinor, debt.currency)} blur={blur} />
        </div>
        <div className="figure">
          <span className="muted">On its own, at the minimum</span>
          <span className="figure-value">
            {own?.paidOffOn ? `paid off ${monthYear(own.paidOffOn)}` : own ? 'not paid off' : '-'}
          </span>
        </div>
        <hr className="divider" />
        <div className="figure">
          <span className="item-title">In your plan</span>
          <span className="figure-value">
            {inPlan?.paidOffOn ? `paid off ${monthYear(inPlan.paidOffOn)}` : summary?.notPlanned ? 'not in it yet' : 'not at this amount'}
          </span>
        </div>
        {summary?.notPlanned === 'noSchedule' && <p className="faint">Add its next due date and it joins the plan.</p>}
        {summary?.notPlanned === 'zeroBalance' && <p className="faint">Add its balance and it joins the plan.</p>}
        {summary?.notPlanned === 'otherCurrency' && (
          <p className="faint">
            It's in {debt.currency}, and the plan is in {currency}, so it isn't planned alongside the others.
          </p>
        )}
      </div>

      <AddToCalendar
        build={(options) => calendarForDebt(debt, setAmountLabel(debt), Date.now(), options)}
        kind="debt"
        filename={DEBT_CALENDAR_FILENAME}
        className="btn btn-primary btn-wide"
        nothingToAdd="It needs a balance and its next due date before there is anything to put in a calendar."
      />

      <div className="btn-row">
        <button type="button" className="btn" onClick={onDone}>
          Done
        </button>
        <button type="button" className="btn" onClick={onAddAnother}>
          Add another
        </button>
        <button type="button" className="btn btn-quiet" onClick={onChange}>
          Change something
        </button>
      </div>
    </Section>
  );
}
