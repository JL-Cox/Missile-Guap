import { useCallback } from 'react';
import { db, saveSubscription } from '../db';
import type { DateKey, Subscription } from '../types';
import { withChargePaid } from '../lib/paid';
import { undoAction } from '../lib/undo';
import { todayKey } from '../lib/time';
import { useToast } from './ui';

/**
 * Marks one subscription charge paid, or not paid, and says so with Undo -
 * the one way every screen does it, so Today and Money behave the same.
 * Reads the stored subscription first, so a mark never writes back a stale
 * copy of something edited elsewhere.
 */
export function useMarkPaid(): (sub: Subscription, date: DateKey, paid: boolean) => Promise<void> {
  const toast = useToast();
  return useCallback(
    async (sub, date, paid) => {
      const before = (await db.subscriptions.get(sub.id)) ?? sub;
      const after = await saveSubscription(withChargePaid(before, date, paid, todayKey()));
      const name = sub.name.trim() || 'That charge';
      toast(
        paid ? `${name} marked paid. It's out of what is still to come.` : `${name} is back in what is still to come.`,
        undoAction(db.subscriptions, [{ before, after }], toast),
      );
    },
    [toast],
  );
}
