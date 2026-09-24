import { useMemo, useState, type ReactNode } from 'react';
import { db, saveDebtPlan } from '../db';
import type { Debt, DebtPlan, DebtStrategy, IncomeSource, Subscription } from '../types';
import { buildDebtPlan, type DebtPlanView } from '../lib/payoff';
import { checksPerYear } from '../lib/debtchecks';
import { whyNoPayPeriod } from '../lib/cashflow';
import { formatMoney, parseMoney } from '../lib/money';
import { monthYear, STRATEGY_HINTS, STRATEGY_LABELS, wholeMoney } from '../lib/debtwords';
import { canRestore, undoAction, undoneMessage } from '../lib/undo';
import { todayKey } from '../lib/time';
import { Amount, FormError, useToast } from './ui';

const STRATEGIES: DebtStrategy[] = ['avalanche', 'snowball'];

/**
 * Which debt gets the extra. Saved the moment it is tapped, like the
 * Backlog's sort: it is a choice to look at, not a form to fill in, and the
 * plan's dates change in front of you as you switch.
 */
export function StrategyButtons({ strategy }: { strategy: DebtStrategy }) {
  return (
    <div className="stack-sm">
      <div className="btn-row" role="group" aria-label="Which debt gets the extra">
        {STRATEGIES.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={strategy === s}
            className={`btn btn-sm${strategy === s ? ' btn-primary' : ''}`}
            onClick={() => void saveDebtPlan({ strategy: s })}
          >
            {STRATEGY_LABELS[s]}
          </button>
        ))}
      </div>
      <p className="faint">{STRATEGY_HINTS[strategy]}</p>
    </div>
  );
}

/** A stored amount as the text its box starts with. Zero is kept: it was chosen. */
const amountText = (minor: number | undefined): string => (minor !== undefined && Number.isFinite(minor) ? (minor / 100).toFixed(2) : '');

/**
 * The plan's inputs: how much goes toward debt from each check, and the
 * rough monthly figure for everything Steady doesn't track, which is only
 * used to suggest an amount.
 *
 * The suggestion is never applied by itself. It sits next to its box with a
 * "Use" button, and nothing is saved until Save - so there is never a "the
 * app picked a number for me" moment, and never a plan that was only
 * suggested showing up on Money and Today as if it had been chosen.
 */
export default function DebtPlanEditor({
  plan,
  debts,
  incomes,
  subs,
  currency,
  blurAmounts,
  onSaved,
  onCancel,
  onOpenMoney,
}: {
  plan: DebtPlan;
  debts: Debt[];
  incomes: IncomeSource[];
  subs: Subscription[];
  currency: string;
  blurAmounts: boolean;
  onSaved: () => void;
  onCancel: () => void;
  onOpenMoney: () => void;
}) {
  const today = todayKey();
  const toast = useToast();
  const [perCheckTexts, setPerCheckTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(incomes.map((s) => [s.id, amountText(plan.perCheckMinor?.[s.id])])),
  );
  const [untrackedText, setUntrackedText] = useState(amountText(plan.untrackedMonthlyMinor));
  const [perMonthText, setPerMonthText] = useState(amountText(plan.perMonthMinor));
  const [error, setError] = useState('');
  const money = (minor: number) => formatMoney(minor, currency);

  /**
   * The plan as the form stands, and the first thing that stops it saving.
   * An unreadable box counts as empty for the preview, so the line below
   * never jumps about while you are typing.
   */
  const assemble = (
    sources: IncomeSource[],
  ): { draft: DebtPlan; problem: string } => {
    const problems: string[] = [];
    const read = (text: string, what: string): number | undefined => {
      if (!text.trim()) return undefined;
      const minor = parseMoney(text);
      if (minor === null || minor < 0) {
        problems.push(`That ${what} isn't a number I can read. Try something like 320.00.`);
        return undefined;
      }
      return minor;
    };
    // Amounts for a job that is not shown here - one that has ended - are
    // kept as they were; they no longer change anything.
    const perCheck: Record<string, number> = Object.fromEntries(
      Object.entries(plan.perCheckMinor ?? {}).filter(([id]) => !sources.some((s) => s.id === id)),
    );
    for (const s of sources) {
      const minor = read(perCheckTexts[s.id] ?? '', 'amount');
      if (minor !== undefined) perCheck[s.id] = minor;
    }
    const withIncome = sources.length > 0;
    const draft: DebtPlan = {
      ...plan,
      perCheckMinor: Object.keys(perCheck).length > 0 ? perCheck : undefined,
      untrackedMonthlyMinor: withIncome ? read(untrackedText, 'monthly figure') : plan.untrackedMonthlyMinor,
      perMonthMinor: withIncome ? plan.perMonthMinor : read(perMonthText, 'amount'),
    };
    return { draft, problem: problems[0] ?? '' };
  };

  // Which jobs have paydays to set an amount for. Nothing typed here changes it.
  const perYear = useMemo(() => checksPerYear(incomes, today), [incomes, today]);
  const sources = incomes.filter((s) => (perYear[s.id] ?? 0) > 0);
  const { draft, problem } = assemble(sources);
  const key = JSON.stringify(draft);
  // The plan as it would be with what is typed now, for the suggestion and
  // the preview line. The engine does every sum; this only reads it.
  const view = useMemo(
    () => buildDebtPlan({ debts, plan: draft, incomes, subs, from: today, currency }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, debts, incomes, subs, today, currency],
  );
  const suggestion = view.suggestion;
  const one = sources.length === 1;

  const save = async () => {
    if (problem) {
      setError(problem);
      return;
    }
    const before = await db.debtPlan.get('plan');
    const after = await saveDebtPlan({
      perCheckMinor: draft.perCheckMinor,
      untrackedMonthlyMinor: draft.untrackedMonthlyMinor,
      perMonthMinor: draft.perMonthMinor,
    });
    // Nothing was stored before - the plan was only the default - so Undo
    // takes the new one away again, unless it has been changed since.
    const undo = before
      ? undoAction(db.debtPlan, [{ before, after }], toast)
      : {
          label: 'Undo',
          run: async () => {
            const current = await db.debtPlan.get('plan');
            if (canRestore(current, after)) {
              await db.debtPlan.delete('plan');
              toast(undoneMessage('restored'));
            } else {
              toast(undoneMessage('changed'));
            }
          },
        };
    toast('Plan saved.', undo);
    onSaved();
  };

  const noPeriod = sources.length === 0 ? whyNoPayPeriod(incomes, today) : null;

  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2>Your debt plan</h2>

      <fieldset className="field">
        <legend>Which debt gets the extra</legend>
        <StrategyButtons strategy={plan.strategy} />
        <p className="faint">Saved as soon as you tap it.</p>
      </fieldset>

      {sources.length > 0 ? (
        <>
          <fieldset className="field stack">
            <legend>Toward debt from each check</legend>
            <p className="faint">
              Everything a check puts toward debt, the minimums included. When a debt is paid off, what went to it
              moves to the next one, so this stays the same. Leave it blank to keep paying today's minimums.
            </p>
            {sources.map((s) => {
              const mine = suggestion.perSource.find((p) => p.source.id === s.id);
              const id = `plan-check-${s.id}`;
              return (
                <div key={s.id} className="field">
                  <label htmlFor={id}>{one ? 'From each check' : `From each ${s.name} check`}</label>
                  <input
                    autoComplete="off"
                    id={id}
                    type="text"
                    inputMode="decimal"
                    value={perCheckTexts[s.id] ?? ''}
                    onChange={(e) => {
                      setPerCheckTexts((prev) => ({ ...prev, [s.id]: e.target.value }));
                      setError('');
                    }}
                    placeholder="320.00"
                  />
                  {mine && (
                    <p className="faint">
                      At least <Amount text={money(mine.minimumsNeedMinor)} blur={blurAmounts} /> covers the minimums.
                    </p>
                  )}
                  {mine && suggestion.status === 'ok' && (
                    <div className="spread">
                      <span className="small grow">
                        Suggestion: <Amount text={money(mine.suggestedMinor)} blur={blurAmounts} /> a check.
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm"
                        onClick={() => {
                          setPerCheckTexts((prev) => ({ ...prev, [s.id]: amountText(mine.suggestedMinor) }));
                          setError('');
                        }}
                      >
                        {/* The amount is in the label only when amounts are showing. */}
                        {blurAmounts ? 'Use the suggestion' : `Use ${money(mine.suggestedMinor)}`}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            {suggestion.status === 'ok' && (
              <p className="faint">
                The suggestion is the minimums, plus half of what's left after subscriptions and everything else. The
                other half stays with you for surprises.
              </p>
            )}
          </fieldset>

          <div className="field">
            <label htmlFor="plan-untracked">Everything else, each month (optional)</label>
            <input
              autoComplete="off"
              id="plan-untracked"
              type="text"
              inputMode="decimal"
              value={untrackedText}
              onChange={(e) => {
                setUntrackedText(e.target.value);
                setError('');
              }}
              placeholder="1800.00"
            />
            <p className="faint">
              Rent, food, fuel, bills Steady doesn't track. A rough number is fine. It's only used to suggest an
              amount.
            </p>
            {suggestion.status === 'needsEstimate' && (
              <p className="faint">
                Add what everything else costs and Steady can suggest an amount. Or type any amount you like.
              </p>
            )}
            {suggestion.status === 'belowMinimums' && (
              <p className="faint">
                After subscriptions and your estimate, your checks don't quite cover the minimums, so the suggestion
                is just the minimums. Many lenders will lower a payment or move a due date if you ask.
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="field">
          <label htmlFor="plan-month">Toward debt each month</label>
          <input
            autoComplete="off"
            id="plan-month"
            type="text"
            inputMode="decimal"
            value={perMonthText}
            onChange={(e) => {
              setPerMonthText(e.target.value);
              setError('');
            }}
            placeholder="400.00"
          />
          <p className="faint">
            At least <Amount text={money(view.comparison.minimumsNowMinor)} blur={blurAmounts} /> covers the
            minimums. Leave it blank to keep paying today's minimums.
          </p>
          <div className="spread">
            <span className="faint grow">
              {noPeriod?.kind === 'needsRecentPayday'
                ? `Add a recent payday to ${noPeriod.source.name} on the Money tab, and this can be set per paycheck instead.`
                : 'Add your income on the Money tab, and this can be set per paycheck instead.'}
            </span>
            <button type="button" className="btn btn-sm" onClick={onOpenMoney}>
              Open Money
            </button>
          </div>
        </div>
      )}

      <p className="small" aria-live="polite">
        <PlanPreview view={view} one={one} money={money} currency={currency} blur={blurAmounts} />
      </p>

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

/** "With $320 from each check: all paid off by March 2029, with about $2,100 in interest." */
function PlanPreview({
  view,
  one,
  money,
  currency,
  blur,
}: {
  view: DebtPlanView;
  one: boolean;
  money: (minor: number) => string;
  currency: string;
  blur: boolean;
}) {
  if (view.planned.length === 0) {
    return <>Once a debt has a balance and its next due date, this shows when it's all paid off.</>;
  }
  const lead: ReactNode =
    view.budgetSource === 'perCheck' ? (
      one ? (
        'With this amount from each check'
      ) : (
        'With these amounts'
      )
    ) : view.budgetSource === 'perMonth' ? (
      <>
        With <Amount text={money(view.budgetMinor)} blur={blur} /> a month
      </>
    ) : (
      "Paying today's minimums, kept the same"
    );
  const r = view.result;
  if (r.status === 'paidOff' && r.paidOffOn) {
    return (
      <>
        {lead}: all paid off by {monthYear(r.paidOffOn, true)}
        {r.totalInterestMinor > 0 ? (
          <>
            , with about <Amount text={wholeMoney(r.totalInterestMinor, currency)} blur={blur} /> in interest.
          </>
        ) : (
          '.'
        )}
      </>
    );
  }
  if (r.status === 'stuck') return <>{lead}, the balances don't go down: the payments about match the interest.</>;
  return <>{lead}, it would take more than 50 years.</>;
}
