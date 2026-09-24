import { useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankIncome, blankSubscription, db, saveSubscription } from '../db';
import type { IncomeSource, Settings, Subscription } from '../types';
import {
  byCategoryYearly,
  deductionsByLabel,
  formatDeduction,
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
import { outlook, stillToCome, whyNoPayPeriod, type PeriodOutlook } from '../lib/cashflow';
import type { CheckView } from '../lib/debtchecks';
import { chargesAndPayments } from '../lib/debtwords';
import { calendarForSubscription, icsFilename } from '../lib/ics';
import AddToCalendar from '../components/AddToCalendar';
import IncomeEditor from '../components/IncomeEditor';
import { useDebtPlan } from '../components/useDebtPlan';
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
import { cancelledMessage } from '../lib/feedback';
import { cutTitle, nameList } from '../lib/sections';
import { undoAction } from '../lib/undo';
import { describeDate, shortDate, todayKey } from '../lib/time';
import {
  Amount,
  ConfirmButton,
  DateShortcuts,
  DetailsButton,
  Empty,
  FormError,
  Section,
  useAutoFocus,
  useBackLayer,
  useNavigate,
  useToast,
} from '../components/ui';

const NO_SUBS: Subscription[] = [];
const NO_INCOMES: IncomeSource[] = [];

/** How the subscription editor should open. */
interface EditorFocus {
  /** Open with More options showing, so nothing you came to change is folded away. */
  expand?: boolean;
  /** Straight to "How do you cancel it?", for the button that asks for exactly that. */
  cancelSteps?: boolean;
}

/**
 * The home-screen shortcut opens the add form once, on launch - not every time
 * the Money tab is visited afterwards.
 */
let shortcutUsed = false;

/**
 * Subscriptions are the classic forgetting tax: money leaving for something you
 * stopped using, and the cancel page is never where you expect. So the two
 * things this screen insists on are "when is the next charge" and "how do I
 * actually get out of this", written down while you still know.
 *
 * Adding one is meant to be a single journey: tap Add, fill in three fields,
 * and the next screen already knows what it costs a year, when it next charges,
 * and offers to put it in your phone's calendar. No trip to Settings.
 *
 * The screen reads top to bottom from glance to reference: the two things to
 * add, what is still to come out and what this paycheck leaves - the two
 * figures set large - then subscriptions, income, and the averages, folded
 * away at the bottom for when you want them. Everything below "Still to come
 * out" folds to one line, so the screen can be as short as you want it.
 */
export default function Money({ settings, startAdding = false }: { settings: Settings; startAdding?: boolean }) {
  const [editing, setEditing] = useState<Subscription | null>(null);
  const [editorFocus, setEditorFocus] = useState<EditorFocus>({});
  const [editingIncome, setEditingIncome] = useState<IncomeSource | null>(null);
  const [justSaved, setJustSaved] = useState<Subscription | null>(null);
  const toast = useToast();
  const today = todayKey();

  useBackLayer(editing !== null || editingIncome !== null || justSaved !== null, () => {
    setEditing(null);
    setEditingIncome(null);
    setJustSaved(null);
  });

  const subs = useLiveQuery(() => db.subscriptions.toArray(), [settings.rev], NO_SUBS) ?? NO_SUBS;
  const incomes = useLiveQuery(() => db.incomes.toArray(), [settings.rev], NO_INCOMES) ?? NO_INCOMES;
  /*
    The debt plan, for its dated payments and what each check puts toward
    debt. Money shows when payments leave and what they leave behind - never
    a balance or a payoff date, which are the Debt tab's.
  */
  const { view: debtView } = useDebtPlan(settings, incomes, subs, today);
  const navigate = useNavigate();
  const active = subs.filter((s) => !s.endedOn).sort((a, b) => yearlyMinor(b) - yearlyMinor(a));
  const ended = subs.filter((s) => s.endedOn);

  const edit = (sub: Subscription, focus: EditorFocus = {}) => {
    setEditorFocus(focus);
    setEditing(sub);
  };

  const startNew = () => {
    setJustSaved(null);
    edit(blankSubscription({ currency: settings.currency, firstBilled: today }));
  };

  const addIncome = () => setEditingIncome(blankIncome({ currency: settings.currency }));

  useEffect(() => {
    if (startAdding && !shortcutUsed) {
      shortcutUsed = true;
      startNew();
    }
    // Once, on first mount: see shortcutUsed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cancelSub = async (sub: Subscription) => {
    const after = await saveSubscription({ ...sub, endedOn: todayKey() });
    toast(
      `${cancelledMessage(sub.name)} ${CALENDAR_ENTRY_STAYS}`,
      undoAction(db.subscriptions, [{ before: sub, after }], toast),
    );
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
                setEditingIncome(null);
                const before = await db.incomes.get(s.id);
                await db.incomes.delete(s.id);
                if (before) toast('Deleted.', undoAction(db.incomes, [{ before, after: undefined }], toast));
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
        existing={isSaved}
        focus={editorFocus}
        knownCategories={categoryChoices(subs.map((s) => s.category))}
        onSaved={(saved) => {
          setEditing(null);
          setJustSaved(saved);
        }}
        onCancel={() => setEditing(null)}
        onDelete={
          isSaved
            ? async (s) => {
                setEditing(null);
                const before = await db.subscriptions.get(s.id);
                await db.subscriptions.delete(s.id);
                if (before) toast('Deleted.', undoAction(db.subscriptions, [{ before, after: undefined }], toast));
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
        onEdit={(focus) => {
          setJustSaved(null);
          edit(justSaved, focus);
        }}
        onDone={() => setJustSaved(null)}
      />
    );
  }

  const blur = settings.blurAmounts;
  const money = (minor: number) => formatMoney(minor, settings.currency);
  const monthly = totalMonthlyMinor(subs);
  const yearly = totalYearlyMinor(subs);
  const categories = byCategoryYearly(subs);
  const maxCategory = categories[0]?.minor ?? 1;

  const activeIncomes = incomes.filter(isActiveIncome);
  const endedIncomes = incomes.filter((src) => !isActiveIncome(src));
  const netMonthly = totalNetMonthlyMinor(incomes);
  // The plan's monthly amount, when there is a plan: the same figure the Debt
  // tab plans on, so the two screens never disagree about what goes to debt.
  const debtMonthly = debtView.planned.length > 0 ? debtView.budgetMinor : 0;
  const leftover = leftoverMonthlyMinor(incomes, subs, debtMonthly);
  const grossYearly = totalGrossYearlyMinor(incomes);
  const netYearly = totalNetYearlyMinor(incomes);
  const deductionRows = deductionsByLabel(incomes);
  const maxDeduction = deductionRows[0]?.minor ?? 1;

  // Real dates rather than monthly averages: what is still going to leave the
  // account before more money arrives, which is the question an average hides.
  // Debt payments are in both, on their due dates.
  const payments = debtView.payments;
  const pending = stillToCome(incomes, subs, today, payments);
  const noPeriod = pending.period ? null : whyNoPayPeriod(incomes, today);
  const [firstCheque, ...laterCheques] = outlook(incomes, subs, today, 4, payments);
  /*
    What the debt plan has each check do. "Left from this paycheck" is read
    from here whenever there is one, so it is the same number on Money and on
    the Debt tab: take-home, less subscriptions, less everything the check
    puts toward debt. With no amount chosen that is exactly the minimums.
  */
  const checkFor = (c: PeriodOutlook) => debtView.checks.find((k) => k.period.start === c.period.start);
  const leftOf = (c: PeriodOutlook) => checkFor(c)?.leftMinor ?? c.leftoverMinor;
  const hasDebt = debtView.planned.length > 0;

  const charges = (count: number, paymentCount: number, until: string) =>
    count + paymentCount === 0
      ? 'Nothing else is due'
      : `${chargesAndPayments(count, paymentCount)}, up to ${describeDate(until, today)}`;

  /*
    One line for each section while it is closed: the fact you would open it
    for. With amounts blurred the line leaves the amount out rather than
    blurring it, because a tappable blurred amount cannot sit inside the
    button that opens the section.
  */
  const chequeName = firstCheque?.current ? 'This paycheck' : 'The next paycheck';
  const laterCount = laterCheques.length === 1 ? 'one' : String(laterCheques.length);
  const chequeLine = !firstCheque
    ? ''
    : !blur
      ? `${chequeName} leaves ${money(leftOf(firstCheque))}`
      : laterCheques.length === 0
        ? chequeName
        : firstCheque.current
          ? `${chequeName} and the next ${laterCount}`
          : `${chequeName} and the ${laterCount} after it`;
  // A paycheck that does not cover its subscriptions is never hidden (see
  // SHORT_CHEQUE), so a folded section says so in its line, in the same words.
  const covers = hasDebt ? 'its subscriptions and payments' : 'its own subscriptions';
  const chequeSummary =
    firstCheque && leftOf(firstCheque) < 0
      ? `${chequeName} does not cover ${covers}`
      : laterCheques.some((c) => leftOf(c) < 0)
        ? `${chequeLine}. A later one does not cover ${covers}`
        : chequeLine;
  const subsSummary =
    active.length === 0
      ? ended.length > 0
        ? `None active, ${ended.length} cancelled`
        : 'Nothing tracked yet'
      : blur
        ? `${active.length} active`
        : `${active.length} active, about ${money(monthly)} a month`;
  const incomeNames = nameList(activeIncomes.map((src) => cutTitle(src.name)));
  const incomeSummary =
    activeIncomes.length === 0
      ? endedIncomes.length > 0
        ? `None current, ${endedIncomes.length} ended`
        : 'Nothing added yet'
      : blur
        ? incomeNames
        : `${incomeNames}, about ${money(netMonthly)} a month`;
  const averagesSummary =
    activeIncomes.length === 0
      ? 'Where the subscription money goes, over a year'
      : blur
        ? 'Each month and over a year'
        : `Left each month, on average: ${money(leftover)}`;

  // When payday falls at the end of the month, the rest of the month is the
  // same charges as before payday. Saying the same figure twice reads as two
  // different amounts to find.
  const sameAsPeriod =
    pending.period !== null &&
    pending.period.minor === pending.month.minor &&
    pending.period.count === pending.month.count &&
    pending.period.paymentCount === pending.month.paymentCount;

  return (
    <>
      {/* The two things you come here to add, together, where they are never
          hunted for. Once there is income, adding more is rarer, and it moves
          to the first button inside Income. */}
      <div className="btn-row btn-row-fill">
        <button type="button" className="btn btn-primary" onClick={startNew}>
          Add a subscription
        </button>
        {activeIncomes.length === 0 && (
          <button type="button" className="btn" onClick={addIncome}>
            Add income
          </button>
        )}
      </div>

      {(subs.some((s) => isActive(s, today)) || payments.length > 0) && (
        <Section title="Still to come out">
          <div className="card stack-sm">
            {pending.period ? (
              <>
                <FigureRow
                  anchor
                  label="Before your next payday"
                  detail={charges(pending.period.count, pending.period.paymentCount, pending.period.until)}
                  amount={money(pending.period.minor)}
                  blur={blur}
                />
                <hr className="divider" />
                {sameAsPeriod ? (
                  <div className="figure">
                    <div className="item-title">Rest of this month</div>
                    <span className="figure-value muted">
                      {pending.month.paymentCount > 0 ? 'The same charges and payments' : 'The same charges'}
                    </span>
                  </div>
                ) : (
                  <FigureRow
                    label="Rest of this month"
                    detail={charges(pending.month.count, pending.month.paymentCount, pending.month.until)}
                    amount={money(pending.month.minor)}
                    blur={blur}
                  />
                )}
              </>
            ) : (
              <>
                <FigureRow
                  anchor
                  label="Rest of this month"
                  detail={charges(pending.month.count, pending.month.paymentCount, pending.month.until)}
                  amount={money(pending.month.minor)}
                  blur={blur}
                />
                <p className="faint">
                  {noPeriod?.kind === 'needsRecentPayday'
                    ? `Add a recent payday to ${noPeriod.source.name} so paydays can be worked out. Then this will also show what is due before your next payday.`
                    : noPeriod?.kind === 'noIncome'
                      ? 'Add your income and this will also show what is due before your next payday.'
                      : "Paydays can't be worked out from your income yet, so what is due before your next payday is left out."}
                </p>
              </>
            )}
            <p className="faint">
              {payments.length > 0
                ? 'Counted from today on the real charge and due dates, so anything that already went out this month is not in here.'
                : 'Counted from today on the real charge dates, so a bill that already went out this month is not in here.'}
            </p>
          </div>
        </Section>
      )}

      {firstCheque && (
        <Section title="Each paycheck" collapsible="money.paychecks" summary={chequeSummary}>
          <p className="faint">
            What each one has to cover before the next arrives. Only the subscriptions
            {hasDebt ? ' and debt payments' : ''} this app knows about — rent, food, fuel and everything else still
            come out of what is left.
          </p>
          <ChequeCard
            cheque={firstCheque}
            check={checkFor(firstCheque)}
            hasDebt={hasDebt}
            today={today}
            money={money}
            blur={blur}
            onOpenDebt={() => navigate('debt')}
          />
          {laterCheques.length > 0 && (
            <div className="stack-sm">
              <h3>The next ones</h3>
              <div className="card card-rows">
                {laterCheques.map((c, i) => (
                  <ChequeRow
                    key={c.period.start}
                    cheque={c}
                    check={checkFor(c)}
                    hasDebt={hasDebt}
                    today={today}
                    money={money}
                    blur={blur}
                    first={i === 0}
                  />
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      <Section title="Subscriptions" collapsible="money.subscriptions" summary={subsSummary}>
        {active.length === 0 ? (
          <Empty>
            Nothing tracked yet. Add anything that takes money on a repeat: streaming, phone, gym, storage, that
            app you signed up for once.
          </Empty>
        ) : (
          <>
            <div className="card stack-sm">
              <div className="figure">
                <span className="muted">Every month, roughly</span>
                <Amount className="figure-value" text={money(monthly)} blur={blur} />
              </div>
              <div className="figure">
                <span className="muted">Every year</span>
                <Amount className="figure-value" text={money(yearly)} blur={blur} />
              </div>
              <p className="faint">
                {active.length} active {active.length === 1 ? 'subscription' : 'subscriptions'}. Weekly costs are
                counted as 52 a year, so the monthly figure is an average rather than an exact bill.
              </p>
            </div>
            <div className="stack-sm">
              {active.map((sub) => (
                <SubscriptionCard
                  key={sub.id}
                  sub={sub}
                  settings={settings}
                  onEdit={(s) => edit(s, { expand: true })}
                  onCancelled={cancelSub}
                />
              ))}
            </div>
          </>
        )}

        {ended.length > 0 && (
          <section className="stack-sm" aria-label="Cancelled">
            <h3>Cancelled</h3>
            {ended.map((sub) => (
              <div key={sub.id} className="item">
                <div className="grow">
                  <div className="item-title">{sub.name}</div>
                  <div className="faint">Stopped {describeDate(sub.endedOn!, today)}</div>
                </div>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => edit(sub, { expand: true })}>
                  Edit
                </button>
              </div>
            ))}
            <p className="faint">Kept so you can see what you used to pay for, and restart one if you need it back.</p>
            <p className="faint">{CALENDAR_ENTRY_STAYS}</p>
          </section>
        )}
      </Section>

      <Section title="Income" collapsible="money.income" summary={incomeSummary}>
        {activeIncomes.length === 0 ? (
          <Empty>
            Add a paycheck and the figures above stop being half a picture. You type gross and net straight off
            the stub - nothing here tries to work out your tax.
          </Empty>
        ) : (
          <>
            <div className="btn-row">
              <button type="button" className="btn btn-sm" onClick={addIncome}>
                Add income
              </button>
            </div>
            <div className="stack-sm">
              {activeIncomes.map((src) => {
                const payday = nextPayday(src, today);
                return (
                  <div key={src.id} className="card card-tight stack-sm">
                    <div className="figure">
                      <span className="item-title">{src.name}</span>
                      <Amount className="figure-value" text={formatMoney(src.netMinor, src.currency)} blur={blur} />
                    </div>
                    <div className="item-foot">
                      <div className="stack-sm">
                        <div className="meta">
                          <span>{describeFrequency(src)}</span>
                          {payday && <span>Next: {describeDate(payday, today)}</span>}
                          <span>
                            <Amount text={`${formatMoney(netMonthlyMinor(src), src.currency)} a month`} blur={blur} />
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm details-btn"
                        onClick={() => setEditingIncome(src)}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {endedIncomes.length > 0 && (
          // The same as Cancelled, for income: kept rather than deleted, and
          // reachable, so "It's current again" is one tap away if a job comes back.
          <section className="stack-sm" aria-label="Ended">
            <h3>Ended</h3>
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
            <p className="faint">Kept so the history is there, and so you can bring one back if it starts again.</p>
          </section>
        )}
      </Section>

      {/* Reference, not glance: averages across the year. Folded away to start
          with, and in the same place whether or not it is open. */}
      {(activeIncomes.length > 0 || grossYearly > 0 || categories.length > 1) && (
        <Section title="Averages" collapsible="money.averages" summary={averagesSummary}>
          {activeIncomes.length > 0 && (
            <div className="stack-sm">
              <h3>Each month, on average</h3>
              <div className="card stack-sm">
                <div className="figure">
                  <span className="muted">Take-home each month</span>
                  <Amount className="figure-value" text={money(netMonthly)} blur={blur} />
                </div>
                <div className="figure">
                  <span className="muted">Subscriptions each month</span>
                  <Amount className="figure-value" text={formatDeduction(monthly, settings.currency)} blur={blur} />
                </div>
                {debtMonthly > 0 && (
                  <div className="figure">
                    <span className="muted">Debt payments each month</span>
                    <Amount className="figure-value" text={formatDeduction(debtMonthly, settings.currency)} blur={blur} />
                  </div>
                )}
                <hr className="divider" />
                <div className="figure">
                  <span className="item-title">Left each month, on average</span>
                  <Amount className="figure-value" text={money(leftover)} blur={blur} />
                </div>
                <p className="faint">
                  It is what is left over after subscriptions{debtMonthly > 0 ? ' and debt payments' : ''}, not spare
                  money.
                </p>
              </div>
            </div>
          )}
          {grossYearly > 0 && (
            <div className="stack-sm">
              <h3>Over a year</h3>
              <div className="card stack-sm">
                <div className="figure">
                  <span className="muted">You earn, a year</span>
                  <Amount className="figure-value" text={money(grossYearly)} blur={blur} />
                </div>
                <div className="figure">
                  <span className="muted">You keep</span>
                  <Amount className="figure-value" text={money(netYearly)} blur={blur} />
                </div>
                <p className="faint">
                  {Math.round(((grossYearly - netYearly) / grossYearly) * 100)}% comes out before you ever see it.
                </p>
              </div>
            </div>
          )}
          {deductionRows.length > 0 && (
            <Bars
              title="What comes out of your pay"
              rows={deductionRows.map((r) => ({ key: r.label, minor: r.minor }))}
              max={maxDeduction}
              money={money}
              blur={blur}
            />
          )}
          {categories.length > 1 && (
            <Bars
              title="Where the subscription money goes"
              rows={categories.map((c) => ({ key: c.category, minor: c.minor }))}
              max={maxCategory}
              money={money}
              blur={blur}
            />
          )}
        </Section>
      )}
    </>
  );
}

/**
 * A label, an optional line under it, and its figure on the right. `anchor`
 * sets the figure large: only the two figures the screen is built around.
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

/** Never hidden and never clamped to zero, and said in words rather than red. */
const SHORT_CHEQUE =
  'This one does not cover its own subscriptions. Worth moving a charge date or cancelling something before it lands.';
/** The same, once debt payments come out of the check too. */
const SHORT_CHEQUE_WITH_PAYMENTS =
  "This one doesn't cover the subscriptions and payments due before the next one. Many lenders will move a due date if you ask.";

/** One line of what a check pays out, set as a minus - or, for money kept from the check before, a plus. */
function LineRow({
  label,
  minor,
  money,
  blur,
  into = false,
}: {
  label: string;
  minor: number;
  money: (minor: number) => string;
  blur: boolean;
  into?: boolean;
}) {
  return (
    <div className="figure small">
      <span className="muted">{label}</span>
      <Amount className="figure-value" text={into ? `+${money(minor)}` : `−${money(minor)}`} blur={blur} />
    </div>
  );
}

/**
 * The paycheck you are in now (or the next one), in full.
 *
 * With a debt plan, `check` is what the plan has this check do. Its parts add
 * up to what the check puts toward debt - the minimums due before the next
 * check, the extra, and money kept back for a busy check coming or used from
 * the one before - so "Left from this paycheck" is the same figure the Debt
 * tab shows, and each line of the way there is on the card.
 */
function ChequeCard({
  cheque: c,
  check,
  hasDebt,
  today,
  money,
  blur,
  onOpenDebt,
}: {
  cheque: PeriodOutlook;
  check: CheckView | undefined;
  hasDebt: boolean;
  today: string;
  money: (minor: number) => string;
  blur: boolean;
  onOpenDebt: () => void;
}) {
  const left = check?.leftMinor ?? c.leftoverMinor;
  const paymentsMinor = check?.minimumsMinor ?? c.paymentsMinor;
  const towardDebt = (check?.towardDebtMinor ?? c.paymentsMinor) > 0;
  return (
    <div className="card stack-sm">
      <FigureRow
        label={c.current ? 'This paycheck' : describeDate(c.period.start, today)}
        detail={`${c.period.paidBy.map((s) => s.name).join(', ')} · covers to ${describeDate(c.period.end, today)}`}
        amount={money(c.period.incomeMinor)}
        blur={blur}
      />
      <div className="figure small">
        <span className="muted">Subscriptions due</span>
        <Amount className="figure-value" text={c.billsMinor ? `−${money(c.billsMinor)}` : money(0)} blur={blur} />
      </div>
      {paymentsMinor > 0 && <LineRow label="Debt payments due" minor={paymentsMinor} money={money} blur={blur} />}
      {check && check.extraMinor > 0 && (
        <LineRow label="Extra toward debt" minor={check.extraMinor} money={money} blur={blur} />
      )}
      {check && check.keepForLaterMinor > 0 && (
        <LineRow label="Kept for the next check's payments" minor={check.keepForLaterMinor} money={money} blur={blur} />
      )}
      {check && check.usesKeptMinor > 0 && (
        <LineRow label="Kept from the last check" minor={check.usesKeptMinor} money={money} blur={blur} into />
      )}
      <hr className="divider" />
      <FigureRow
        anchor={c.current}
        label={c.current ? 'Left from this paycheck' : 'Left from that paycheck'}
        amount={money(left)}
        blur={blur}
      />
      {c.current && c.remainingMinor !== c.billsMinor + c.paymentsMinor && (
        <p className="faint">
          <Amount text={money(c.remainingMinor)} blur={blur} /> of the{' '}
          {c.paymentsMinor > 0 ? 'subscriptions and payments has' : 'subscriptions has'} not gone out yet.
        </p>
      )}
      {left < 0 && <p className="notice">{hasDebt ? SHORT_CHEQUE_WITH_PAYMENTS : SHORT_CHEQUE}</p>}
      {towardDebt && (
        <div className="spread">
          <span className="faint grow">Which debt, and why, is on the Debt tab.</span>
          <button type="button" className="btn btn-sm" onClick={onOpenDebt}>
            Open Debt
          </button>
        </div>
      )}
    </div>
  );
}

/** A later paycheck, as one row of a shared card: when, what it leaves, and why. */
function ChequeRow({
  cheque: c,
  check,
  hasDebt,
  today,
  money,
  blur,
  first,
}: {
  cheque: PeriodOutlook;
  check: CheckView | undefined;
  hasDebt: boolean;
  today: string;
  money: (minor: number) => string;
  blur: boolean;
  first: boolean;
}) {
  const left = check?.leftMinor ?? c.leftoverMinor;
  const toDebt = check?.towardDebtMinor ?? c.paymentsMinor;
  return (
    <>
      {!first && <hr className="divider" />}
      <div className="stack-sm">
        <div className="figure">
          <div>
            <div className="item-title">
              <span className="nowrap">{shortDate(c.period.start, today)}</span> · covers to{' '}
              <span className="nowrap">{shortDate(c.period.end, today)}</span>
            </div>
            <div className="meta">
              <span>
                <Amount text={money(c.period.incomeMinor)} blur={blur} /> in
              </span>
              <span>
                <Amount text={money(c.billsMinor)} blur={blur} /> in subscriptions
              </span>
              {toDebt > 0 && (
                <span>
                  <Amount text={money(toDebt)} blur={blur} /> to debt
                </span>
              )}
            </div>
          </div>
          <Amount className="figure-value" text={money(left)} blur={blur} />
        </div>
        {left < 0 && <p className="notice">{hasDebt ? SHORT_CHEQUE_WITH_PAYMENTS : SHORT_CHEQUE}</p>}
      </div>
    </>
  );
}

/** A labelled figure with a bar under it, for the averages over a year. */
function Bars({
  title,
  rows,
  max,
  money,
  blur,
}: {
  title: string;
  rows: { key: string; minor: number }[];
  max: number;
  money: (minor: number) => string;
  blur: boolean;
}) {
  return (
    <div className="stack-sm">
      <h3>{title}</h3>
      {rows.map((row) => (
        <div key={row.key} className="stack-sm">
          <div className="figure small">
            <span>{row.key}</span>
            <Amount className="figure-value" text={money(row.minor)} blur={blur} />
          </div>
          <div className="bar-track">
            {/* The one inline style left: a length that is data, not design. */}
            <div className="bar" style={{ width: `${Math.max(3, (row.minor / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
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
  onEdit: (focus: EditorFocus) => void;
  onDone: () => void;
}) {
  const next = nextBilling(sub);

  return (
    <Section title={`${sub.name} is saved`}>
      <div className="card stack-sm">
        <div className="figure">
          <span className="muted">Each charge</span>
          <Amount className="figure-value" text={formatMoney(sub.amountMinor, sub.currency)} blur={blurAmounts} />
        </div>
        <div className="figure">
          <span className="muted">How often</span>
          <span className="figure-value">{describeBilling(sub)}</span>
        </div>
        <div className="figure">
          <span className="muted">Next charge</span>
          <span className="figure-value">{next ? describeDate(next) : 'None - it is cancelled'}</span>
        </div>
        <hr className="divider" />
        <div className="figure">
          <span className="muted">That works out at</span>
          <Amount
            className="figure-value"
            text={`${formatMoney(monthlyMinor(sub), sub.currency)} a month`}
            blur={blurAmounts}
          />
        </div>
        <div className="figure">
          <span className="item-title">Over a year</span>
          <Amount className="figure-value amount-key" text={formatMoney(yearlyMinor(sub), sub.currency)} blur={blurAmounts} />
        </div>
        {sub.category && (
          <div className="figure">
            <span className="muted">Filed under</span>
            <span className="figure-value">
              <span className="tag">{sub.category}</span>
            </span>
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
          <div className="btn-row">
            <button type="button" className="btn btn-sm" onClick={() => onEdit({ expand: true, cancelSteps: true })}>
              Add the cancellation steps
            </button>
          </div>
        </div>
      )}

      <div className="btn-row">
        <button type="button" className="btn" onClick={onDone}>
          Done
        </button>
        <button type="button" className="btn" onClick={onAddAnother}>
          Add another
        </button>
        <button type="button" className="btn btn-quiet" onClick={() => onEdit({ expand: true })}>
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
  onCancelled,
}: {
  sub: Subscription;
  settings: Settings;
  onEdit: (sub: Subscription) => void;
  onCancelled: (sub: Subscription) => void;
}) {
  const [open, setOpen] = useState(false);
  const next = nextBilling(sub);
  const detailsId = `sub-details-${sub.id}`;

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
          {sub.name}
        </button>
        <Amount
          className="figure-value"
          text={formatMoney(sub.amountMinor, sub.currency)}
          blur={settings.blurAmounts}
        />
      </div>
      <div className="item-foot">
        <div className="stack-sm">
          <div className="meta">
            <span>{describeBilling(sub)}</span>
            {next && <span>Next: {describeDate(next)}</span>}
            {sub.category && <span className="tag">{sub.category}</span>}
          </div>
        </div>
        <DetailsButton open={open} onToggle={() => setOpen((v) => !v)} controls={detailsId} />
      </div>

      {open && (
        <div id={detailsId} className="stack-sm">
          <div className="figure small">
            <span className="muted">Works out at</span>
            <Amount
              className="figure-value"
              text={`${formatMoney(monthlyMinor(sub), sub.currency)} a month / ${formatMoney(yearlyMinor(sub), sub.currency)} a year`}
              blur={settings.blurAmounts}
            />
          </div>
          {sub.cancelHow.trim() ? (
            <div className="card card-quiet card-tight">
              <p className="small item-title">To cancel:</p>
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
              onConfirm={() => onCancelled(sub)}
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
  existing,
  focus,
  knownCategories,
  onSaved,
  onCancel,
  onDelete,
}: {
  sub: Subscription;
  /** Saved before: its date is the one it was first charged on, not the next one. */
  existing: boolean;
  focus: EditorFocus;
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
  const [showMore, setShowMore] = useState(
    Boolean(focus.expand || focus.cancelSteps || sub.cancelHow || sub.notes || sub.every !== 1),
  );
  const [customCategory, setCustomCategory] = useState(
    Boolean(sub.category && !knownCategories.includes(sub.category)),
  );
  // "Add the cancellation steps" lands in the box it names, not at the top.
  const nameRef = useAutoFocus<HTMLInputElement>(!focus.cancelSteps);
  const cancelRef = useAutoFocus<HTMLTextAreaElement>(Boolean(focus.cancelSteps));

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
  /** The next charge as the form stands, for the line under "First charged". */
  const nextCharge = nextBilling(
    { ...draft, every: fixedDay ? 1 : everyValue, daysOfMonth: fixedDay ? daysValue : undefined },
    today,
  );

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
          <div className="btn-row">
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

      <fieldset className="field">
        <legend>How often</legend>
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
      </fieldset>

      {fixedDay && (
        <div className="field">
          <label htmlFor="sub-days">Which days of the month?</label>
          <div className="btn-row" role="group" aria-label="Which days of the month?">
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
          />
          <p className="faint">
            Charges {describeCycle(draft.cycle, everyValue, daysValue)}. Use 31 for the last day - it lands on
            the 28th in February and the 30th in April automatically.
          </p>
        </div>
      )}

      <div className="field">
        <label htmlFor="sub-first">
          {fixedDay ? 'Charging from' : existing ? 'First charged' : 'Date of the next charge'}
        </label>
        {/* One-tap days for a new one. A saved one's date is where its whole
            schedule is counted from, so it is not offered as "Today". */}
        {!existing && (
          <DateShortcuts
            value={draft.firstBilled}
            today={today}
            label="Date of the next charge"
            onPick={(date) => date && patch({ firstBilled: date })}
          />
        )}
        <input
          autoComplete="off"
          id="sub-first"
          type="date"
          value={draft.firstBilled}
          onChange={(e) => patch({ firstBilled: e.target.value })}
        />
        {existing && !fixedDay ? (
          <p className="small">Next: {nextCharge ? describeDate(nextCharge, today) : 'none - it is cancelled'}</p>
        ) : (
          <p className="faint">{describeDate(draft.firstBilled, today)}.</p>
        )}
        <p className="faint">
          {fixedDay
            ? 'The charges land on the days above; this only says when they start, so the first one is the first of those dates on or after it.'
            : 'Every future date is worked out from this one, so it only has to be right once.'}
        </p>
      </div>

      <fieldset className="field">
        <legend>Category</legend>
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
          />
        )}
      </fieldset>

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
        <button type="button" className="btn btn-quiet btn-sm" aria-expanded={false} onClick={() => setShowMore(true)}>
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
              ref={cancelRef}
              value={draft.cancelHow}
              onChange={(e) => patch({ cancelHow: e.target.value })}
              placeholder="Account > Membership > Cancel. Or: call 1-800-555-0199 with the account number."
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

      <FormError message={error} />

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
