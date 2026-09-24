import { useMemo, useState } from 'react';
import { saveDebt } from '../db';
import type { DateKey, Debt, DebtKind, DebtPlan, DebtPromo, MinimumRule } from '../types';
import {
  applyKindPreset,
  DEBT_KIND_LABELS,
  DEBT_KIND_PRESETS,
  DEBT_KINDS,
  installmentPaymentMinor,
  isInterestOnly,
  nextDueOn,
  type DebtDetail,
} from '../lib/debt';
import { buildDebtPlan, type DebtSummary } from '../lib/payoff';
import { formatMoney, parseMoney, parsePercent } from '../lib/money';
import { monthYear, wholeMoney } from '../lib/debtwords';
import { addDays, fromDateKey, shortDate, SHORT_MONTHS, todayKey } from '../lib/time';
import { Amount, ConfirmButton, FormError, useAutoFocus } from './ui';

/**
 * Adding or changing a debt.
 *
 * Only the name is required, as everywhere else in Steady. A debt joins the
 * plan once it has a balance and its next due date; until then it is listed
 * and simply says what it still needs. What every statement shows - the
 * balance, the rate, the minimum and the due date - is on the form; the rest
 * - a credit limit, a promo rate, a loan's terms, a fee, notes - waits behind
 * "More details".
 *
 * There is deliberately no box for an account number, a login, a card
 * number or anything else worth stealing, and the notes hint says not to put
 * them there either.
 */

type RuleChoice = 'fixed' | 'card' | 'share' | 'interest';

const RULE_CHOICES: { id: RuleChoice; label: string }[] = [
  { id: 'fixed', label: 'A set amount' },
  { id: 'card', label: 'A share plus interest (most cards)' },
  { id: 'share', label: 'A share of the balance' },
  { id: 'interest', label: 'Interest only' },
];

/** What each choice starts with, so switching to one never shows empty boxes. */
const RULE_DEFAULTS: Record<'card' | 'share', { percent: string; floor: string }> = {
  card: { percent: '1', floor: '35.00' },
  share: { percent: '3', floor: '30.00' },
};

function ruleChoiceOf(rule: MinimumRule): RuleChoice {
  if (rule.kind === 'fixed') return 'fixed';
  if (rule.kind === 'percentOfBalance') return 'share';
  return isInterestOnly(rule) ? 'interest' : 'card';
}

const DETAIL_WORDS: Record<DebtDetail, string> = {
  limit: 'a credit limit',
  promo: 'a lower rate for now',
  loan: "the loan's terms",
};

const ALL_DETAILS: DebtDetail[] = ['limit', 'promo', 'loan'];

const LONG_MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** An amount as the text a box starts with: "2480.00", or blank for nothing. */
const moneyText = (minor: number | undefined): string =>
  minor !== undefined && Number.isFinite(minor) && minor > 0 ? (minor / 100).toFixed(2) : '';

const percentText = (percent: number | undefined): string =>
  percent !== undefined && Number.isFinite(percent) ? String(percent) : '';

/** The largest balance the engine will plan: $10 million, in cents. */
const MAX_BALANCE_MINOR = 1_000_000_000;

const dayOf = (date: DateKey) => fromDateKey(date).getDate();
const isLastDayOfMonth = (date: DateKey) => dayOf(addDays(date, 1)) === 1;

/** Every optional field that is empty, taken out rather than stored as undefined. */
function withoutEmpty(debt: Debt): Debt {
  const out = { ...debt } as Record<string, unknown>;
  for (const key of Object.keys(out)) if (out[key] === undefined) delete out[key];
  return out as unknown as Debt;
}

/** A plan with nothing chosen, for the form's own "on its own, at the minimum" line. */
const ON_ITS_OWN: DebtPlan = { id: 'plan', strategy: 'avalanche', createdAt: 0, updatedAt: 0 };

export default function DebtEditor({
  debt,
  existing,
  blurAmounts,
  openMore = false,
  onSaved,
  onCancel,
  onDelete,
}: {
  debt: Debt;
  /** Saved before. A new one gets the kind presets when a kind is tapped. */
  existing: boolean;
  blurAmounts: boolean;
  /** Open with More details showing, for a button that sends you to something in there. */
  openMore?: boolean;
  onSaved: (debt: Debt) => void;
  onCancel: () => void;
  /** Absent for a debt that has not been saved yet: there is nothing to delete. */
  onDelete?: (debt: Debt) => void;
}) {
  const today = todayKey();
  const [draft, setDraft] = useState(debt);
  const [error, setError] = useState('');
  /*
    Every number is held as the text you typed and only read as a number when
    it is used, for the reason IncomeEditor gives: a box that reformats itself
    while you type strands the caret and mangles what you meant.
  */
  const [balanceText, setBalanceText] = useState(moneyText(debt.balanceMinor));
  const [asOfTouched, setAsOfTouched] = useState(false);
  const [aprText, setAprText] = useState(percentText(debt.aprPercent));
  const [rule, setRule] = useState<RuleChoice>(ruleChoiceOf(debt.minimum));
  const [fixedText, setFixedText] = useState(debt.minimum.kind === 'fixed' ? moneyText(debt.minimum.amountMinor) : '');
  const [sharePercentText, setSharePercentText] = useState(
    debt.minimum.kind === 'fixed' || isInterestOnly(debt.minimum)
      ? RULE_DEFAULTS.card.percent
      : String(debt.minimum.percent),
  );
  const [floorText, setFloorText] = useState(
    debt.minimum.kind === 'fixed' || isInterestOnly(debt.minimum)
      ? RULE_DEFAULTS.card.floor
      : moneyText(debt.minimum.floorMinor),
  );
  /*
    The next due date, as a date. A monthly debt stores only its day of the
    month, so the date is worked out from it here; it is written back only if
    it was changed, so a debt due on the 30th is not quietly moved to the 28th
    because the next one happens to fall in February.
  */
  const [dueText, setDueText] = useState(() => nextDueOn(debt, today) ?? '');
  const [dueTouched, setDueTouched] = useState(false);
  const [lastDay, setLastDay] = useState(debt.cadence !== 'every2weeks' && debt.dueDay === 31);

  const [limitText, setLimitText] = useState(moneyText(debt.creditLimitMinor));
  const [promoRateText, setPromoRateText] = useState(percentText(debt.promo?.aprPercent));
  const [promoEnds, setPromoEnds] = useState(debt.promo?.endsOn ?? '');
  const [promoDeferred, setPromoDeferred] = useState(debt.promo?.deferred ?? DEBT_KIND_PRESETS[debt.kind].promoDeferred);
  const [promoPartText, setPromoPartText] = useState(moneyText(debt.promo?.balanceMinor));
  const [heldBackText, setHeldBackText] = useState(moneyText(debt.promo?.heldBackMinor));
  const [feeText, setFeeText] = useState(moneyText(debt.fee?.amountMinor));
  const [feeEvery, setFeeEvery] = useState<'month' | 'year'>(debt.fee?.every ?? 'year');
  const [feeMonth, setFeeMonth] = useState(debt.fee?.month ?? fromDateKey(today).getMonth() + 1);
  const [loanOriginalText, setLoanOriginalText] = useState(moneyText(debt.loan?.originalMinor));
  const [loanTermText, setLoanTermText] = useState(debt.loan?.termMonths ? String(debt.loan.termMonths) : '');
  const [loanFirst, setLoanFirst] = useState(debt.loan?.firstPaymentOn ?? '');

  const hasDetails = (detail: DebtDetail) =>
    detail === 'limit'
      ? Boolean(debt.creditLimitMinor)
      : detail === 'promo'
        ? Boolean(debt.promo)
        : Boolean(debt.loan?.originalMinor || debt.loan?.termMonths || debt.loan?.firstPaymentOn);
  const [showMore, setShowMore] = useState(
    openMore ||
      debt.cadence === 'every2weeks' ||
      Boolean(debt.notes.trim() || debt.fee) ||
      ALL_DETAILS.some(hasDetails),
  );
  const [showAllDetails, setShowAllDetails] = useState(false);
  const nameRef = useAutoFocus<HTMLInputElement>();

  const patch = (changes: Partial<Debt>) => setDraft((d) => ({ ...d, ...changes }));
  const every2Weeks = draft.cadence === 'every2weeks';

  /**
   * The debt as the form stands, and the first thing that stops it saving.
   * The preview line uses the debt even while there is a problem, reading an
   * unreadable number as nothing, so it never flickers away mid-typing.
   */
  const assemble = (): { debt: Debt; error: string } => {
    const problems: string[] = [];
    const readMoney = (text: string, what: string, example: string): number | undefined => {
      if (!text.trim()) return undefined;
      const minor = parseMoney(text);
      if (minor === null) {
        problems.push(`That ${what} isn't a number I can read. Try something like ${example}.`);
        return undefined;
      }
      if (minor < 0) {
        problems.push(`That ${what} can't be below 0.`);
        return undefined;
      }
      return minor;
    };
    const readPercent = (text: string, what: string, example: string, max: number): number | undefined => {
      if (!text.trim()) return undefined;
      const percent = parsePercent(text);
      if (percent === null) {
        problems.push(`That ${what} isn't a number I can read. Try something like ${example}.`);
        return undefined;
      }
      if (percent > max) {
        problems.push(`That ${what} is higher than a statement would show. Try something like ${example}.`);
        return undefined;
      }
      return percent;
    };

    const balanceMinor = readMoney(balanceText, 'balance', '2480.00') ?? 0;
    if (balanceMinor > MAX_BALANCE_MINOR) problems.push('That balance is more than Steady can plan for.');
    const aprPercent = readPercent(aprText, 'rate', '24.99', 999.99);

    let minimum: MinimumRule;
    if (rule === 'fixed') {
      minimum = { kind: 'fixed', amountMinor: readMoney(fixedText, 'minimum', '35.00') ?? 0 };
    } else if (rule === 'interest') {
      minimum = { kind: 'percentPlusInterest', percent: 0, floorMinor: 0 };
    } else {
      const percent = readPercent(sharePercentText, 'share of the balance', '1', 100) ?? 0;
      const floorMinor = readMoney(floorText, 'minimum', '35.00') ?? 0;
      minimum = { kind: rule === 'card' ? 'percentPlusInterest' : 'percentOfBalance', percent, floorMinor };
    }

    let promo: DebtPromo | undefined;
    const promoRate = readPercent(promoRateText, 'promo rate', '0', 999.99);
    if (promoRateText.trim() || promoEnds) {
      if (!promoRateText.trim()) problems.push('Add the promo rate too, or clear its date.');
      else if (!promoEnds) problems.push('Add the date the promo ends too, or clear its rate.');
      const part = readMoney(promoPartText, 'promo part of the balance', '800.00');
      if (part !== undefined && part > balanceMinor) problems.push("The part on the promo rate can't be more than the balance.");
      const heldBack = promoDeferred ? readMoney(heldBackText, 'held-back interest', '120.00') : undefined;
      if (promoRate !== undefined && promoEnds) {
        promo = {
          aprPercent: promoRate,
          endsOn: promoEnds,
          deferred: promoDeferred,
          ...(part !== undefined ? { balanceMinor: part } : {}),
          ...(heldBack !== undefined ? { heldBackMinor: heldBack } : {}),
        };
      }
    }

    const limit = readMoney(limitText, 'credit limit', '5000.00');
    const feeMinor = readMoney(feeText, 'fee', '95.00');
    const original = readMoney(loanOriginalText, 'amount borrowed', '20000.00');
    let termMonths: number | undefined;
    if (loanTermText.trim()) {
      const n = Number(loanTermText.trim());
      if (!Number.isInteger(n) || n < 1 || n > 600) problems.push('The length of the loan is a whole number of months, like 60.');
      else termMonths = n;
    }
    const loan =
      original !== undefined || termMonths !== undefined || loanFirst
        ? {
            ...(original !== undefined ? { originalMinor: original } : {}),
            ...(termMonths !== undefined ? { termMonths } : {}),
            ...(loanFirst ? { firstPaymentOn: loanFirst } : {}),
          }
        : undefined;

    let dueDay: number | undefined;
    let nextDue: DateKey | undefined;
    if (dueText) {
      if (every2Weeks) nextDue = dueText;
      else dueDay = lastDay ? 31 : dueTouched || draft.dueDay === undefined ? dayOf(dueText) : draft.dueDay;
    }

    const debt = withoutEmpty({
      ...draft,
      name: draft.name.trim(),
      balanceMinor,
      aprPercent,
      minimum,
      promo,
      creditLimitMinor: limit,
      fee: feeMinor ? { amountMinor: feeMinor, every: feeEvery, ...(feeEvery === 'year' ? { month: feeMonth } : {}) } : undefined,
      loan,
      dueDay,
      nextDueOn: nextDue,
      cadence: every2Weeks ? 'every2weeks' : undefined,
    });
    return { debt, error: problems[0] ?? '' };
  };

  const current = assemble();
  // Keyed on the debt's content, so the plan runs again only when a number
  // that changes it does - not on every render.
  const key = JSON.stringify(current.debt);
  const preview = useMemo(
    () =>
      buildDebtPlan({ debts: [current.debt], plan: ON_ITS_OWN, incomes: [], subs: [], from: today, currency: current.debt.currency }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, today],
  );
  const summary = preview.debts[0];

  /** A kind tapped on a new debt fills in its usual minimum, rate and rhythm; on a saved one it only relabels it. */
  const pickKind = (kind: DebtKind) => {
    if (existing) {
      patch({ kind });
      return;
    }
    const next = applyKindPreset(current.debt, kind);
    setDraft((d) => ({ ...d, kind, cadence: next.cadence }));
    setAprText(percentText(next.aprPercent));
    setRule(ruleChoiceOf(next.minimum));
    if (next.minimum.kind !== 'fixed' && !isInterestOnly(next.minimum)) {
      setSharePercentText(String(next.minimum.percent));
      setFloorText(moneyText(next.minimum.floorMinor));
    }
    setPromoDeferred(DEBT_KIND_PRESETS[kind].promoDeferred);
  };

  const pickRule = (choice: RuleChoice) => {
    setRule(choice);
    setError('');
    if (choice === 'card' || choice === 'share') {
      setSharePercentText(RULE_DEFAULTS[choice].percent);
      setFloorText(RULE_DEFAULTS[choice].floor);
    }
  };

  const offered = new Set<DebtDetail>([...DEBT_KIND_PRESETS[draft.kind].details, ...ALL_DETAILS.filter(hasDetails)]);
  const shown = (detail: DebtDetail) => showAllDetails || offered.has(detail);
  const hidden = ALL_DETAILS.filter((d) => !shown(d));

  const money = (minor: number) => formatMoney(minor, draft.currency);
  const loanPayment =
    current.debt.loan?.originalMinor && current.debt.loan.termMonths && current.debt.aprPercent !== undefined
      ? installmentPaymentMinor(current.debt.loan.originalMinor, current.debt.aprPercent, current.debt.loan.termMonths)
      : null;

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const { debt: next, error: problem } = assemble();
        if (problem) {
          setError(problem);
          return;
        }
        if (!next.name) return;
        onSaved(await saveDebt(next));
      }}
    >
      <div className="field">
        <label htmlFor="debt-name">What is it?</label>
        <input
          autoComplete="off"
          id="debt-name"
          ref={nameRef}
          type="text"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Visa card"
        />
        <p className="faint">A name you'll recognize. No account numbers needed.</p>
      </div>

      <fieldset className="field">
        <legend>What kind is it?</legend>
        <div className="btn-row">
          {DEBT_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={draft.kind === kind}
              className={`btn btn-sm${draft.kind === kind ? ' btn-primary' : ''}`}
              onClick={() => pickKind(kind)}
            >
              {DEBT_KIND_LABELS[kind]}
            </button>
          ))}
        </div>
        <p className="faint">Optional. It only changes which details are offered below.</p>
      </fieldset>

      <div className="field-row">
        <div className="field">
          <label htmlFor="debt-balance">Balance</label>
          <input
            autoComplete="off"
            id="debt-balance"
            type="text"
            inputMode="decimal"
            value={balanceText}
            onChange={(e) => {
              setBalanceText(e.target.value);
              setError('');
              // A new balance is a balance as of today, unless you said otherwise.
              if (!asOfTouched) patch({ balanceAsOf: today });
            }}
            placeholder="2480.00"
          />
        </div>
        <div className="field">
          <label htmlFor="debt-as-of">Balance as of</label>
          <input
            autoComplete="off"
            id="debt-as-of"
            type="date"
            value={draft.balanceAsOf}
            onChange={(e) => {
              setAsOfTouched(true);
              patch({ balanceAsOf: e.target.value || today });
            }}
          />
        </div>
      </div>
      <p className="faint">What's left to pay, from your latest statement or app.</p>

      <div className="field">
        <label htmlFor="debt-apr">Interest rate (APR)</label>
        <input
          autoComplete="off"
          id="debt-apr"
          type="text"
          inputMode="decimal"
          value={aprText}
          onChange={(e) => {
            setAprText(e.target.value);
            setError('');
          }}
          placeholder="24.99"
        />
        <p className="faint">It's on the statement as APR. Use 0 if there's no interest.</p>
      </div>

      <fieldset className="field">
        <legend>Minimum payment</legend>
        <div className="btn-row">
          {RULE_CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              aria-pressed={rule === choice.id}
              className={`btn btn-sm${rule === choice.id ? ' btn-primary' : ''}`}
              onClick={() => pickRule(choice.id)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        {rule === 'fixed' && (
          <div className="field">
            <label htmlFor="debt-minimum">Each payment</label>
            <input
              autoComplete="off"
              id="debt-minimum"
              type="text"
              inputMode="decimal"
              value={fixedText}
              onChange={(e) => {
                setFixedText(e.target.value);
                setError('');
              }}
              placeholder="35.00"
            />
            <p className="faint">The smallest payment the statement asks for. Leave it blank if there's no set amount.</p>
          </div>
        )}
        {(rule === 'card' || rule === 'share') && (
          <div className="field-row">
            <div className="field">
              <label htmlFor="debt-percent">Percent</label>
              <input
                autoComplete="off"
                id="debt-percent"
                type="text"
                inputMode="decimal"
                value={sharePercentText}
                onChange={(e) => {
                  setSharePercentText(e.target.value);
                  setError('');
                }}
                placeholder={RULE_DEFAULTS[rule].percent}
              />
            </div>
            <div className="field">
              <label htmlFor="debt-floor">At least</label>
              <input
                autoComplete="off"
                id="debt-floor"
                type="text"
                inputMode="decimal"
                value={floorText}
                onChange={(e) => {
                  setFloorText(e.target.value);
                  setError('');
                }}
                placeholder={RULE_DEFAULTS[rule].floor}
              />
            </div>
          </div>
        )}
        <p className="faint">
          {rule === 'card'
            ? "Most cards ask for 1% of the balance plus the month's interest, at least $35. The statement says how yours works."
            : rule === 'share'
              ? 'Some store cards ask for a share of the balance, like 3%, with a smallest amount.'
              : rule === 'interest'
                ? "The month's interest and nothing more, like a home equity line in its draw period."
                : 'Loans, buy now pay later, medical plans and family usually ask for the same amount each time.'}
        </p>
      </fieldset>

      <div className="field">
        <label htmlFor="debt-due">Next payment due</label>
        <input
          autoComplete="off"
          id="debt-due"
          type="date"
          value={dueText}
          onChange={(e) => {
            setDueText(e.target.value);
            setDueTouched(true);
            if (!e.target.value || !isLastDayOfMonth(e.target.value)) setLastDay(false);
          }}
        />
        {!every2Weeks && dueText && isLastDayOfMonth(dueText) && dayOf(dueText) < 31 && (
          <label className="check">
            <input
              type="checkbox"
              checked={lastDay}
              onChange={(e) => {
                setLastDay(e.target.checked);
                setDueTouched(true);
              }}
            />
            <span>It's due on the last day of every month</span>
          </label>
        )}
        <p className="faint">
          {every2Weeks
            ? 'Later due dates are worked out from this one, 2 weeks apart.'
            : 'Later due dates are worked out from this one, a month apart. Without it, this debt is listed but not in the plan.'}
        </p>
      </div>

      <label className="check">
        <input type="checkbox" checked={draft.autopay} onChange={(e) => patch({ autopay: e.target.checked })} />
        <span>Autopay is on</span>
      </label>

      <p className="small" aria-live="polite">
        <Preview summary={summary} debt={current.debt} money={money} blur={blurAmounts} />
      </p>

      {!showMore ? (
        <button type="button" className="btn btn-quiet btn-sm" aria-expanded={false} onClick={() => setShowMore(true)}>
          More details (limit, promo rate, how often, notes)
        </button>
      ) : (
        <>
          <hr className="divider" />

          <fieldset className="field">
            <legend>How often is it due?</legend>
            <div className="btn-row">
              {(
                [
                  ['monthly', 'Monthly'],
                  ['every2weeks', 'Every 2 weeks'],
                ] as const
              ).map(([cadence, label]) => {
                const on = (draft.cadence ?? 'monthly') === cadence;
                return (
                  <button
                    key={cadence}
                    type="button"
                    aria-pressed={on}
                    className={`btn btn-sm${on ? ' btn-primary' : ''}`}
                    onClick={() => {
                      patch({ cadence: cadence === 'monthly' ? undefined : cadence });
                      setDueTouched(true);
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <p className="faint">Pay-in-4 plans are usually every 2 weeks.</p>
          </fieldset>

          {shown('limit') && (
            <div className="field">
              <label htmlFor="debt-limit">Credit limit</label>
              <input
                autoComplete="off"
                id="debt-limit"
                type="text"
                inputMode="decimal"
                value={limitText}
                onChange={(e) => {
                  setLimitText(e.target.value);
                  setError('');
                }}
                placeholder="5000.00"
              />
              <p className="faint">For your reference. It doesn't change the plan.</p>
            </div>
          )}

          {shown('promo') && (
            <fieldset className="field stack-sm">
              <legend>A lower rate for now</legend>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="debt-promo-rate">Promo rate (%)</label>
                  <input
                    autoComplete="off"
                    id="debt-promo-rate"
                    type="text"
                    inputMode="decimal"
                    value={promoRateText}
                    onChange={(e) => {
                      setPromoRateText(e.target.value);
                      setError('');
                    }}
                    placeholder="0"
                  />
                </div>
                <div className="field">
                  <label htmlFor="debt-promo-ends">Until</label>
                  <input
                    autoComplete="off"
                    id="debt-promo-ends"
                    type="date"
                    value={promoEnds}
                    onChange={(e) => {
                      setPromoEnds(e.target.value);
                      setError('');
                    }}
                  />
                </div>
              </div>
              <p className="faint">Like 0% for 12 months. After that date, the rate above is used.</p>
              <div className="field">
                <span className="inline-label faint">
                  If it isn't paid off by then, is the interest since the purchase added back?
                </span>
                <div className="btn-row" role="group" aria-label="Is the interest added back if it isn't paid off in time?">
                  <button
                    type="button"
                    aria-pressed={promoDeferred}
                    className={`btn btn-sm${promoDeferred ? ' btn-primary' : ''}`}
                    onClick={() => setPromoDeferred(true)}
                  >
                    Yes, "no interest if paid in full"
                  </button>
                  <button
                    type="button"
                    aria-pressed={!promoDeferred}
                    className={`btn btn-sm${!promoDeferred ? ' btn-primary' : ''}`}
                    onClick={() => setPromoDeferred(false)}
                  >
                    No, it's a 0% intro rate
                  </button>
                </div>
              </div>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="debt-promo-part">Part of the balance on this rate</label>
                  <input
                    autoComplete="off"
                    id="debt-promo-part"
                    type="text"
                    inputMode="decimal"
                    value={promoPartText}
                    onChange={(e) => {
                      setPromoPartText(e.target.value);
                      setError('');
                    }}
                    placeholder="All of it"
                  />
                </div>
                {promoDeferred && (
                  <div className="field">
                    <label htmlFor="debt-held-back">Interest held back so far</label>
                    <input
                      autoComplete="off"
                      id="debt-held-back"
                      type="text"
                      inputMode="decimal"
                      value={heldBackText}
                      onChange={(e) => {
                        setHeldBackText(e.target.value);
                        setError('');
                      }}
                      placeholder="0.00"
                    />
                  </div>
                )}
              </div>
              <p className="faint">
                Leave the part blank if the whole balance is on the promo. Some statements show the held-back interest;
                leave it blank if yours doesn't.
              </p>
            </fieldset>
          )}

          {shown('loan') && (
            <fieldset className="field stack-sm">
              <legend>The loan's terms</legend>
              <div className="field-row">
                <div className="field">
                  <label htmlFor="debt-loan-original">Amount borrowed</label>
                  <input
                    autoComplete="off"
                    id="debt-loan-original"
                    type="text"
                    inputMode="decimal"
                    value={loanOriginalText}
                    onChange={(e) => {
                      setLoanOriginalText(e.target.value);
                      setError('');
                    }}
                    placeholder="20000.00"
                  />
                </div>
                <div className="field">
                  <label htmlFor="debt-loan-term">Length in months</label>
                  <input
                    autoComplete="off"
                    id="debt-loan-term"
                    type="text"
                    inputMode="numeric"
                    value={loanTermText}
                    onChange={(e) => {
                      setLoanTermText(e.target.value);
                      setError('');
                    }}
                    placeholder="60"
                  />
                </div>
              </div>
              <div className="field">
                <label htmlFor="debt-loan-first">First payment</label>
                <input
                  autoComplete="off"
                  id="debt-loan-first"
                  type="date"
                  value={loanFirst}
                  onChange={(e) => setLoanFirst(e.target.value)}
                />
              </div>
              {loanPayment !== null && (
                <div className="spread">
                  <span className="faint grow">
                    At this rate that works out to <Amount text={money(loanPayment)} blur={blurAmounts} /> a month.
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => {
                      setRule('fixed');
                      setFixedText(moneyText(loanPayment));
                    }}
                  >
                    Use it as the payment
                  </button>
                </div>
              )}
              <p className="faint">
                Used to work out a payment and to say when it was scheduled to finish. The plan itself works from the
                balance and the payment.
              </p>
            </fieldset>
          )}

          {hidden.length > 0 && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShowAllDetails(true)}>
              Also add {hidden.map((d) => DETAIL_WORDS[d]).join(' or ')}
            </button>
          )}

          <fieldset className="field stack-sm">
            <legend>A fee</legend>
            <div className="field-row">
              <div className="field">
                <label htmlFor="debt-fee">Fee amount</label>
                <input
                  autoComplete="off"
                  id="debt-fee"
                  type="text"
                  inputMode="decimal"
                  value={feeText}
                  onChange={(e) => {
                    setFeeText(e.target.value);
                    setError('');
                  }}
                  placeholder="95.00"
                />
              </div>
              {feeEvery === 'year' && (
                <div className="field">
                  <label htmlFor="debt-fee-month">Charged in</label>
                  <select id="debt-fee-month" value={feeMonth} onChange={(e) => setFeeMonth(Number(e.target.value))}>
                    {LONG_MONTH_NAMES.map((name, i) => (
                      <option key={name} value={i + 1}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="btn-row" role="group" aria-label="How often the fee is charged">
              {(
                [
                  ['year', 'Once a year'],
                  ['month', 'Every month'],
                ] as const
              ).map(([every, label]) => (
                <button
                  key={every}
                  type="button"
                  aria-pressed={feeEvery === every}
                  className={`btn btn-sm${feeEvery === every ? ' btn-primary' : ''}`}
                  onClick={() => setFeeEvery(every)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="faint">An annual fee or a monthly one. It's added to the balance when it's charged.</p>
          </fieldset>

          <div className="field">
            <label htmlFor="debt-notes">Notes</label>
            <textarea
              autoComplete="off"
              id="debt-notes"
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="How to pay, the phone number, the mailing address"
            />
            <p className="faint">
              Don't put logins, passwords or full account numbers here. Notes are saved in backup files as plain text.
            </p>
          </div>
        </>
      )}

      {draft.paidOffOn && (
        <div className="card card-quiet spread">
          <span className="small">Marked as paid off on {shortDate(draft.paidOffOn, today)}.</span>
          <button type="button" className="btn btn-sm" onClick={() => patch({ paidOffOn: undefined })}>
            It's being paid again
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
        {/* Neither applies to a debt that has not been saved yet. */}
        {onDelete && (
          <div className="btn-row">
            {!draft.paidOffOn && (
              <ConfirmButton
                label="Mark as paid off"
                confirmLabel="Yes, it's paid off"
                className="btn btn-quiet btn-sm"
                onConfirm={() => patch({ paidOffOn: today })}
              />
            )}
            <ConfirmButton
              label="Delete"
              confirmLabel="Yes, delete it"
              className="btn btn-quiet btn-sm"
              onConfirm={() => onDelete(draft)}
            />
          </div>
        )}
      </div>
    </form>
  );
}

/**
 * The form's one line of arithmetic, said in words: this debt on its own, at
 * its minimum. Every figure is the engine's; this only chooses the sentence.
 */
function Preview({
  summary,
  debt,
  money,
  blur,
}: {
  summary: DebtSummary | undefined;
  debt: Debt;
  money: (minor: number) => string;
  blur: boolean;
}) {
  if (!summary || summary.notPlanned === 'paidOff') return null;
  if (summary.notPlanned === 'zeroBalance') return <>Add the balance to see when it's paid off.</>;
  if (summary.notPlanned === 'noSchedule') return <>Add the next due date to see when it's paid off.</>;
  if (summary.noSetPayment) {
    return <>No set payment, so on its own it isn't paid off. In your plan, it's paid from the extra.</>;
  }
  if (summary.growsAtMinimum && summary.paymentToShrinkMinor !== null) {
    return (
      <>
        At its minimum alone this balance wouldn't come down: its interest is about{' '}
        <Amount text={money(summary.interestNowMinor)} blur={blur} /> a month. Paying{' '}
        <Amount text={money(summary.paymentToShrinkMinor)} blur={blur} /> or more a month brings it down.
      </>
    );
  }
  const own = summary.minimumsOnly;
  const first = summary.next?.minimumMinor ?? 0;
  if (!own) return null;
  if (!own.paidOffOn) {
    return <>Paying only its minimum, this balance stops coming down, so on its own it isn't paid off. Your plan pays it from the extra.</>;
  }
  const fixed = debt.minimum.kind === 'fixed';
  const interest =
    own.interestMinor > 0 ? (
      <>
        , with about <Amount text={wholeMoney(own.interestMinor, debt.currency)} blur={blur} /> in interest
      </>
    ) : (
      ', with no interest'
    );
  return (
    <>
      {fixed ? (
        <>
          At <Amount text={money(first)} blur={blur} /> a month on its own
        </>
      ) : (
        <>
          Paying only its minimum (<Amount text={money(first)} blur={blur} /> to start)
        </>
      )}
      , this is paid off by {monthYear(own.paidOffOn)}
      {interest}.{summary.missingRate ? " No rate yet, so interest isn't counted." : ''}
    </>
  );
}

/* ---------------------------------------------------------------------------
   A new balance for one debt
   -------------------------------------------------------------------------- */

/**
 * One money box for a debt's balance, used by "Update balance" and by
 * "Paid", which fills it with what the plan expects is left. A balance of 0
 * asks once whether the debt is paid off, and never moves it by itself.
 */
export function BalanceForm({
  debt,
  label,
  startMinor,
  hint,
  askDate = false,
  saveLabel = 'Save',
  onSave,
  onCancel,
}: {
  debt: Debt;
  label: string;
  /** What the box starts with; nothing for a blank box. */
  startMinor?: number;
  hint: string;
  /** Offer an "As of" date; without one the balance is as of today. */
  askDate?: boolean;
  saveLabel?: string;
  onSave: (change: { balanceMinor: number; balanceAsOf: DateKey; paidOff: boolean }) => void;
  onCancel: () => void;
}) {
  const today = todayKey();
  const [text, setText] = useState(startMinor !== undefined ? (startMinor / 100).toFixed(2) : '');
  const [asOf, setAsOf] = useState(today);
  const [error, setError] = useState('');
  const [zero, setZero] = useState(false);
  const inputRef = useAutoFocus<HTMLInputElement>();
  const id = `balance-${debt.id}`;

  const read = (): number | null => {
    const minor = parseMoney(text);
    if (minor === null || !text.trim()) {
      setError("That balance isn't a number I can read. Try something like 2480.00.");
      return null;
    }
    if (minor < 0) {
      setError("A balance here is what's left to pay, so it can't be below 0.");
      return null;
    }
    return minor;
  };

  if (zero) {
    return (
      <div className="card card-quiet stack-sm" role="status">
        <p className="small">That's zero. Mark {debt.name} as paid off?</p>
        <div className="btn-row">
          <button
            type="button"
            className="btn btn-sm btn-primary"
            onClick={() => onSave({ balanceMinor: 0, balanceAsOf: asOf, paidOff: true })}
          >
            Yes, it's paid off
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onSave({ balanceMinor: 0, balanceAsOf: asOf, paidOff: false })}
          >
            Not yet
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="card card-quiet stack-sm"
      onSubmit={(e) => {
        e.preventDefault();
        const minor = read();
        if (minor === null) return;
        if (minor === 0) setZero(true);
        else onSave({ balanceMinor: minor, balanceAsOf: asOf, paidOff: false });
      }}
    >
      <div className="field-row">
        <div className="field">
          <label htmlFor={id}>{label}</label>
          <input
            autoComplete="off"
            id={id}
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError('');
            }}
            placeholder="2480.00"
          />
        </div>
        {askDate && (
          <div className="field">
            <label htmlFor={`${id}-as-of`}>As of</label>
            <input
              autoComplete="off"
              id={`${id}-as-of`}
              type="date"
              value={asOf}
              onChange={(e) => setAsOf(e.target.value || today)}
            />
          </div>
        )}
      </div>
      <p className="faint">{hint}</p>
      <FormError message={error} />
      <div className="btn-row">
        <button type="submit" className="btn btn-sm btn-primary">
          {saveLabel}
        </button>
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ---------------------------------------------------------------------------
   Every balance at once
   -------------------------------------------------------------------------- */

/**
 * The monthly routine in one step: one box per debt and one date. A box left
 * empty leaves that balance as it is, so updating only the card whose
 * statement just came is as quick as updating all of them.
 */
export function UpdateBalances({
  debts,
  blurAmounts,
  onSaved,
  onCancel,
}: {
  debts: Debt[];
  blurAmounts: boolean;
  onSaved: (pairs: { before: Debt; after: Debt }[]) => void;
  onCancel: () => void;
}) {
  const today = todayKey();
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [asOf, setAsOf] = useState(today);
  const [error, setError] = useState('');
  const firstRef = useAutoFocus<HTMLInputElement>();

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const changes: { debt: Debt; balanceMinor: number }[] = [];
        for (const debt of debts) {
          const text = texts[debt.id]?.trim() ?? '';
          if (!text) continue;
          const minor = parseMoney(text);
          if (minor === null || minor < 0) {
            setError(`${debt.name}'s balance isn't a number I can read. Try something like 2480.00.`);
            return;
          }
          changes.push({ debt, balanceMinor: minor });
        }
        const pairs: { before: Debt; after: Debt }[] = [];
        for (const { debt, balanceMinor } of changes) {
          pairs.push({ before: debt, after: await saveDebt({ ...debt, balanceMinor, balanceAsOf: asOf }) });
        }
        onSaved(pairs);
      }}
    >
      <h2>Update balances</h2>
      <p className="faint">Type what each statement or app says now. Any you leave alone stay as they are.</p>
      {debts.map((debt, i) => (
        <div key={debt.id} className="field">
          <label htmlFor={`balances-${debt.id}`}>{debt.name}</label>
          <input
            autoComplete="off"
            id={`balances-${debt.id}`}
            ref={i === 0 ? firstRef : undefined}
            type="text"
            inputMode="decimal"
            value={texts[debt.id] ?? ''}
            onChange={(e) => {
              setTexts((prev) => ({ ...prev, [debt.id]: e.target.value }));
              setError('');
            }}
            placeholder="Leave as it is"
          />
          <p className="faint">
            Now <Amount text={formatMoney(debt.balanceMinor, debt.currency)} blur={blurAmounts} /> on{' '}
            {shortDate(debt.balanceAsOf, today)}
          </p>
        </div>
      ))}
      <div className="field">
        <label htmlFor="balances-as-of">As of</label>
        <input
          autoComplete="off"
          id="balances-as-of"
          type="date"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value || today)}
        />
        <p className="faint">One date for all of them. Change it if the statements are from an earlier day.</p>
      </div>
      <FormError message={error} />
      <div className="btn-row">
        <button type="submit" className="btn btn-primary">
          Save
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A month, 1-12, as "Mar": for the month a yearly fee lands in, on the debt's details. */
export const monthName = (month: number): string => SHORT_MONTHS[(month - 1 + 12) % 12];
