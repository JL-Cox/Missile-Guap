import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, blankTask } from '../db';
import type { IncomeSource, Settings, Task } from '../types';
import { agendaFor, stillOpen, unscheduled, upcomingBills } from '../lib/agenda';
import { paydaysFrom } from '../lib/cashflow';
import { sortTasks } from '../lib/priority';
import { describeDate, describeDuration, todayKey } from '../lib/time';
import { formatMoney } from '../lib/money';
import TaskRow from '../components/TaskRow';
import TaskEditor from '../components/TaskEditor';
import { useTaskActions } from '../components/taskActions';
import { Amount, Empty, Section, useBackLayer } from '../components/ui';

/** How many waiting tasks show before "Show N more" - the same number every day. */
const WAITING_SHOWN = 3;
/** How many upcoming charges fit before the list says "more on the Money screen". */
const BILLS_SHOWN = 6;

/**
 * The one screen to open when you cannot face opening anything. Fixed order,
 * every single day: what is happening today, what is still waiting, what money
 * is about to move. Never a different layout depending on what's in it.
 */
export default function Today({ settings }: { settings: Settings }) {
  const today = todayKey();
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const { move, undateAll, remove } = useTaskActions();
  useBackLayer(editing !== null, () => setEditing(null));

  const tasks = useLiveQuery(() => db.tasks.toArray(), [settings.rev], [] as Task[]) ?? [];
  const subs = useLiveQuery(() => db.subscriptions.toArray(), [settings.rev], []) ?? [];
  const incomes = useLiveQuery(() => db.incomes.toArray(), [settings.rev], [] as IncomeSource[]) ?? [];

  const agenda = agendaFor(today, tasks, subs);
  const openToday = agenda.filter((i) => i.kind === 'task' && i.task && !i.task.doneAt);
  const chargedToday = agenda.filter((i) => i.kind === 'billing');
  const doneToday = agenda.filter((i) => i.kind === 'task' && i.task?.doneAt);
  const waiting = stillOpen(tasks, today);
  const waitingShown = showAllWaiting ? waiting : waiting.slice(0, WAITING_SHOWN);
  // The most pressing five, not the five most recent - otherwise this and the
  // Backlog tab would disagree about what matters, which is worse than either
  // order on its own.
  const loose = sortTasks(unscheduled(tasks), 'priority').slice(0, 5);
  const bills = upcomingBills(subs, settings.lookaheadDays, today).filter((b) => b.inDays > 0);

  // "Can this wait until I get paid?" is only answerable if payday is on screen.
  // The monthly figure counts every job, including one paid today.
  const { today: paidToday, soon: paidSoon, monthlyMinor: monthlyFromAll } = paydaysFrom(incomes, today);

  if (editing) {
    const saved = tasks.some((t) => t.id === editing.id);
    return (
      <TaskEditor
        task={editing}
        onSaved={() => setEditing(null)}
        onCancel={() => setEditing(null)}
        // The same Delete as on Tasks and Backlog - only for something saved.
        onDelete={
          saved
            ? async (t) => {
                setEditing(null);
                await remove(t);
              }
            : undefined
        }
      />
    );
  }

  return (
    <>
      <Section
        title="Today"
        aside={
          <button type="button" className="btn btn-sm" onClick={() => setEditing(blankTask({ date: today }))}>
            Add to today
          </button>
        }
      >
        {openToday.length === 0 && chargedToday.length === 0 ? (
          <Empty>
            Nothing is planned for today. That is allowed. Anything you add with a date of today shows up here.
          </Empty>
        ) : (
          openToday.length > 0 && (
            <div className="stack-sm">
              {openToday.map((item) => (
                <TaskRow key={item.key} task={item.task!} onEdit={setEditing} />
              ))}
            </div>
          )
        )}

        {/* Money that leaves today is a fact about today, grouped under its
            own quiet heading rather than flagged row by row. */}
        {chargedToday.length > 0 && (
          <div className="stack-sm">
            <h3>Charged today</h3>
            {chargedToday.map((item) => (
              <div key={item.key} className="item">
                <div className="figure grow">
                  <span className="item-title">{item.subscription?.name ?? item.title}</span>
                  <Amount
                    className="figure-value"
                    text={formatMoney(item.amountMinor ?? 0, item.subscription?.currency ?? settings.currency)}
                    blur={settings.blurAmounts}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {doneToday.length > 0 && (
          <div className="stack-sm">
            <div className="btn-row">
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                aria-expanded={showDone}
                onClick={() => setShowDone((v) => !v)}
              >
                {showDone ? 'Hide' : 'Show'} {doneToday.length} finished today
              </button>
            </div>
            {showDone &&
              doneToday.map((item) => item.task && <TaskRow key={item.key} task={item.task} onEdit={setEditing} />)}
          </div>
        )}
      </Section>

      {waiting.length > 0 && (
        <Section title="Still waiting">
          <p className="faint">
            These had an earlier date and are not finished. They are not late, they are just still here.
          </p>
          <div className="stack-sm">
            {waitingShown.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onEdit={setEditing}
                showDate
                actions={
                  <>
                    <button type="button" className="btn btn-sm" onClick={() => void move(task, today)}>
                      Move to today
                    </button>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => void move(task, undefined)}>
                      Take the date off
                    </button>
                  </>
                }
              />
            ))}
          </div>
          {/* Always the same three first, and the rest one tap away in the same
              place - never a list whose length decides how the screen looks. */}
          <div className="btn-row">
            {waiting.length > WAITING_SHOWN && (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                aria-expanded={showAllWaiting}
                onClick={() => setShowAllWaiting((v) => !v)}
              >
                {showAllWaiting ? 'Show fewer' : `Show ${waiting.length - WAITING_SHOWN} more`}
              </button>
            )}
            {waiting.length > 1 && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => void undateAll(waiting)}>
                Take the dates off all of these (they go to Backlog)
              </button>
            )}
          </div>
        </Section>
      )}

      {paidToday.length > 0 && (
        <Section title="Payday">
          <div className="stack-sm">
            {paidToday.map(({ source: src }) => (
              <div key={src.id} className="item">
                <div className="figure grow">
                  <div>
                    <div className="item-title">{src.name}</div>
                    <div className="faint">Should land today</div>
                  </div>
                  <Amount className="figure-value" text={formatMoney(src.netMinor, src.currency)} blur={settings.blurAmounts} />
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {bills.length > 0 && (
        <Section title={`Money leaving soon (next ${settings.lookaheadDays} days)`}>
          <div className="stack-sm">
            {bills.slice(0, BILLS_SHOWN).map((b) => (
              <div key={`${b.sub.id}-${b.date}`} className="item">
                <div className="figure grow">
                  <div>
                    <div className="item-title">{b.sub.name}</div>
                    <div className="faint">{describeDate(b.date, today)}</div>
                  </div>
                  <Amount
                    className="figure-value"
                    text={formatMoney(b.sub.amountMinor, b.sub.currency)}
                    blur={settings.blurAmounts}
                  />
                </div>
              </div>
            ))}
          </div>
          {bills.length > BILLS_SHOWN && (
            <p className="faint">{bills.length - BILLS_SHOWN} more on the Money screen.</p>
          )}
        </Section>
      )}

      {paidSoon.length > 0 && (
        <Section title="Next payday">
          <div className="stack-sm">
            {paidSoon.map(({ source: src, date }) => (
              <div key={src.id} className="item">
                <div className="figure grow">
                  <div>
                    <div className="item-title">{src.name}</div>
                    <div className="faint">{describeDate(date, today)}</div>
                  </div>
                  <Amount className="figure-value" text={formatMoney(src.netMinor, src.currency)} blur={settings.blurAmounts} />
                </div>
              </div>
            ))}
          </div>
          <p className="faint">
            Weekends and the holidays you set for each job are already accounted for. About{' '}
            <Amount text={formatMoney(monthlyFromAll, settings.currency)} blur={settings.blurAmounts} /> a month
            between them.
          </p>
        </Section>
      )}

      {loose.length > 0 && (
        <Section title="No date on these">
          <p className="faint">
            The ones nearest the top of your backlog. Give one a day only if you want to.
          </p>
          <div className="stack-sm">
            {loose.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                onEdit={setEditing}
                actions={
                  <button type="button" className="btn btn-sm" onClick={() => void move(task, today)}>
                    Do it today
                  </button>
                }
              />
            ))}
          </div>
        </Section>
      )}

      <p className="faint">
        Planned today: {describeDuration(openToday.reduce((sum, i) => sum + (i.task?.durationMin ?? 0), 0))}. This is
        information, not a target.
      </p>
    </>
  );
}
