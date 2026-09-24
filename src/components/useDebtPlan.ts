import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getDebtPlan } from '../db';
import type { DateKey, Debt, DebtPlan, IncomeSource, Settings, Subscription } from '../types';
import { buildDebtPlan, type DebtPlanView } from '../lib/payoff';

const NO_DEBTS: Debt[] = [];

/** How the plan starts before anything is chosen - the same default getDebtPlan gives. */
const STARTING_PLAN: DebtPlan = { id: 'plan', strategy: 'avalanche', createdAt: 0, updatedAt: 0 };

/**
 * The debt plan, worked out once for a screen.
 *
 * Debt, Money and Today all show figures from the same plan, and each one
 * calls this rather than doing any of the arithmetic itself, so a payment is
 * the same amount on the same day on all three. It runs again only when the
 * debts, the plan, the income, the subscriptions, the day or the currency
 * change - not on every tap elsewhere on the screen.
 */
export function useDebtPlan(
  settings: Settings,
  incomes: IncomeSource[],
  subs: Subscription[],
  from: DateKey,
): { view: DebtPlanView; debts: Debt[]; plan: DebtPlan } {
  const debts = useLiveQuery(() => db.debts.toArray(), [settings.rev], NO_DEBTS) ?? NO_DEBTS;
  const plan = useLiveQuery(() => getDebtPlan(), [settings.rev], STARTING_PLAN) ?? STARTING_PLAN;
  const view = useMemo(
    () => buildDebtPlan({ debts, plan, incomes, subs, from, currency: settings.currency }),
    [debts, plan, incomes, subs, from, settings.currency],
  );
  return { view, debts, plan };
}
