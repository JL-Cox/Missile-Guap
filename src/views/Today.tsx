import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, blankTask } from '../db';
import type { IncomeSource, Settings, Task } from '../types';
import { isActiveIncome, nextPayday } from '../lib/pay';
import { netMonthlyMinor } from '../lib/money';
import { agendaFor, stillOpen, unscheduled, upcomingBills } from '../lib/agenda';
import { describeDate, describeDuration, todayKey } from '../lib/time';
import { formatMoney } from '../lib/money';
import { moveTo } from '../lib/tasks';
import TaskRow from '../components/TaskRow';
import TaskEditor from '../components/TaskEditor';
import { Amount, Empty, Section } from '../components/ui';

/**
 * The one screen to open when you cannot face opening anything. Fixed order,
 * every single day: what is happening today, what is still waiting, what money
 * is about to move. Never a different layout depending on what's in it.
 */
export default function Today({ settings }: { settings: Settings }) {
  const today = todayKey();
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(false);

  const tasks = useLiveQuery(() => db.tasks.toArray(), [settings.rev], [] as Task[]) ?? [];
  const subs = useLiveQuery(() => db.subscriptions.toArray(), [settings.rev], []) ?? [];
  const incomes = useLiveQuery(() => db.incomes.toArray(), [settings.rev], [] as IncomeSource[]) ?? [];

  const agenda = agendaFor(today, tasks, subs);
  const openToday = agenda.filter((i) => i.kind !== 'task' || !i.task?.doneAt);
  const doneToday = agenda.filter((i) => i.kind === 'task' && i.task?.doneAt);
  const waiting = stillOpen(tasks, today);
  const loose = unscheduled(tasks).slice(0, 5);
  const bills = upcomingBills(subs, settings.lookaheadDays, today).filter((b) => b.inDays > 0);

  // "Can this wait until I get paid?" is only answerable if payday is on screen.
  const paydays = incomes
    .filter(isActiveIncome)
    .map((src) => ({ src, date: nextPayday(src, today) }))
    .filter((p): p is { src: IncomeSource; date: string } => p.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
  const paidToday = paydays.filter((p) => p.date === today);
  const paidSoon = paydays.filter((p) => p.date !== today);

  if (editing) {
    return (
      <TaskEditor
        task={editing}
        onSaved={() => setEditing(null)}
        onCancel={() => setEditing(null)}
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
        {openToday.length === 0 ? (
          <Empty>
            Nothing is planned for today. That is allowed. Anything you add with a date of today shows up here.
          </Empty>
        ) : (
          <div className="stack-sm">
            {openToday.map((item) =>
              item.kind === 'task' && item.task ? (
                <TaskRow key={item.key} task={item.task} onEdit={setEditing} />
              ) : (
                <div key={item.key} className="item">
                  <span className="pill pill-warn">Money</span>
                  <div className="grow">
                    <div className="item-title">{item.title}</div>
                    <div className="faint">Charged today</div>
                  </div>
                  <Amount
                    text={formatMoney(item.amountMinor ?? 0, item.subscription?.currency ?? settings.currency)}
                    blur={settings.blurAmounts}
                  />
                </div>
              ),
            )}
          </div>
        )}

        {doneToday.length > 0 && (
          <div className="stack-sm">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Hide' : 'Show'} {doneToday.length} finished today
            </button>
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
            {waiting.slice(0, 8).map((task) => (
              <div key={task.id} className="stack-sm">
                <TaskRow task={task} onEdit={setEditing} showDate />
                <div className="btn-row">
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => void moveTo(task, today)}>
                    Move to today
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => void moveTo(task, undefined)}>
                    Take the date off
                  </button>
                </div>
              </div>
            ))}
          </div>
          {waiting.length > 8 && <p className="faint">{waiting.length - 8} more on the Tasks screen.</p>}
        </Section>
      )}

      {paidToday.length > 0 && (
        <Section title="Payday">
          <div className="stack-sm">
            {paidToday.map(({ src }) => (
              <div key={src.id} className="item">
                <span className="pill">Today</span>
                <div className="grow">
                  <div className="item-title">{src.name}</div>
                  <div className="faint">Should land today</div>
                </div>
                <Amount text={formatMoney(src.netMinor, src.currency)} blur={settings.blurAmounts} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {bills.length > 0 && (
        <Section title={`Money leaving soon (next ${settings.lookaheadDays} days)`}>
          <div className="stack-sm">
            {bills.slice(0, 6).map((b) => (
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

      {paidSoon.length > 0 && (
        <Section title="Next payday">
          <div className="stack-sm">
            {paidSoon.map(({ src, date }) => (
              <div key={src.id} className="item">
                <div className="grow">
                  <div className="item-title">{src.name}</div>
                  <div className="faint">{describeDate(date, today)}</div>
                </div>
                <Amount text={formatMoney(src.netMinor, src.currency)} blur={settings.blurAmounts} />
              </div>
            ))}
          </div>
          <p className="faint">
            Weekends and the holidays you set for each job are already accounted for.
            {paidSoon.length > 0 &&
              ` About ${formatMoney(
                paidSoon.reduce((sum, p) => sum + netMonthlyMinor(p.src), 0),
                settings.currency,
              )} a month between them.`}
          </p>
        </Section>
      )}

      {loose.length > 0 && (
        <Section title="No date on these">
          <p className="faint">Sitting here quietly. Give one a day only if you want to.</p>
          <div className="stack-sm">
            {loose.map((task) => (
              <div key={task.id} className="stack-sm">
                <TaskRow task={task} onEdit={setEditing} />
                <div className="btn-row">
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => void moveTo(task, today)}>
                    Do it today
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <p className="faint">
        Planned today:{' '}
        {describeDuration(
          openToday.reduce((sum, i) => sum + (i.task?.durationMin ?? 0), 0),
        )}
        . This is information, not a target.
      </p>
    </>
  );
}
