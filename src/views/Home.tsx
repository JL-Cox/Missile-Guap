import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { IncomeSource, Settings, Subscription, Task } from '../types';
import { homeGroups } from '../lib/dashboard';
import type { PageId } from '../lib/zones';
import { todayKey } from '../lib/time';
import { useDebtPlan } from '../components/useDebtPlan';
import { Cards, useNavigate } from '../components/ui';

const NO_TASKS: Task[] = [];
const NO_SUBS: Subscription[] = [];
const NO_INCOMES: IncomeSource[] = [];

/**
 * The dashboard the app opens on, and where Back ends up: a card for each
 * working page, in three groups, saying what is worth knowing about it. A
 * card opens its page. What each card says is worked out in
 * src/lib/dashboard.ts; this only gathers the data and lays the cards out.
 */
export default function Home({ settings }: { settings: Settings }) {
  const navigate = useNavigate();
  const today = todayKey();
  const tasks = useLiveQuery(() => db.tasks.toArray(), [settings.rev], NO_TASKS) ?? NO_TASKS;
  const inboxCount = useLiveQuery(() => db.captures.filter((c) => !c.clearedAt).count(), [settings.rev], 0) ?? 0;
  const notes = useLiveQuery(() => db.notes.toArray(), [settings.rev], []) ?? [];
  const subs = useLiveQuery(() => db.subscriptions.toArray(), [settings.rev], NO_SUBS) ?? NO_SUBS;
  const incomes = useLiveQuery(() => db.incomes.toArray(), [settings.rev], NO_INCOMES) ?? NO_INCOMES;
  const { view: debtView, debts } = useDebtPlan(settings, incomes, subs, today);

  const groups = homeGroups({
    today,
    now: Date.now(),
    tasks,
    inboxCount,
    notes,
    subs,
    incomes,
    debtView,
    openDebts: debts.filter((d) => !d.paidOffOn).length,
    settings,
  });

  return (
    <>
      {groups.map((group) => (
        <section key={group.id} className="cards-group" aria-labelledby={`cards-${group.id}`}>
          <h2 id={`cards-${group.id}`} className="cards-heading">
            {group.title}
          </h2>
          <Cards cards={group.cards} label={group.title} kind="page" onOpen={(id) => navigate(id as PageId)} />
        </section>
      ))}
    </>
  );
}
