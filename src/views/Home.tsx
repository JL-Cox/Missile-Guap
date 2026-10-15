import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import type { Settings, Task } from '../types';
import { homeGroups } from '../lib/dashboard';
import type { PageId } from '../lib/zones';
import { todayKey } from '../lib/time';
import { useMoney } from '../components/useDebtPlan';
import { Cards, useNavigate } from '../components/ui';

const NO_TASKS: Task[] = [];

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
  const { subs, incomes, view: debtView, debts, now: money } = useMoney(settings, today);

  const groups = homeGroups({
    today,
    now: Date.now(),
    tasks,
    inboxCount,
    notes,
    subs,
    incomes,
    debtView,
    money,
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
