import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, blankTask, forgetSettings, saveSettings } from '../db';
import type { DateKey, IncomeSource, Settings, Task } from '../types';
import { agendaFor, stillOpen, unscheduled, upcomingBills } from '../lib/agenda';
import { paydaysFrom } from '../lib/cashflow';
import { fitsLowDay, isLowDay, isStaleLowDay } from '../lib/lowday';
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
 * Which folded parts have been opened on a low day. Held in memory only, never
 * saved: they stay open while you move between tabs, and a reload - or
 * tomorrow - folds them away again.
 */
let peeked: { day: DateKey; keys: string[] } = { day: '', keys: [] };

/**
 * The one screen to open when you cannot face opening anything. Fixed order,
 * every single day: what is happening today, what is still waiting, what money
 * is about to move. Never a different layout depending on what's in it.
 *
 * On a low day it is the same screen, quieter: every section stays where it
 * always is, but only what has a time, what is Critical and what you can do on
 * a low day is showing. The rest is folded to one line in its usual place.
 */
export default function Today({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const today = todayKey();
  const [editing, setEditing] = useState<Task | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [showAllWaiting, setShowAllWaiting] = useState(false);
  const [shown, setShown] = useState<string[]>(() => (peeked.day === today ? peeked.keys : []));
  const { move, undateAll, remove } = useTaskActions();
  useBackLayer(editing !== null, () => setEditing(null));

  const low = isLowDay(settings, today);
  /** Whether a part of the screen is folded away for the low day right now. */
  const folded = (key: string) => low && !shown.includes(key);
  const unfold = (key: string) => {
    const keys = [...shown, key];
    peeked = { day: today, keys };
    setShown(keys);
  };

  const startLowDay = async () => {
    peeked = { day: today, keys: [] };
    setShown([]);
    onChange(await saveSettings({ lowDay: today }));
  };
  const endLowDay = async () => onChange(await forgetSettings('lowDay'));

  // One left from before midnight, if the app stayed open across it. The date
  // comparison has already ended it; this deletes it, so it is not kept.
  useEffect(() => {
    if (isStaleLowDay(settings, today)) void forgetSettings('lowDay').then(onChange);
    // Only when the low day or the date changes; onChange is App's setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.lowDay, today]);

  const tasks = useLiveQuery(() => db.tasks.toArray(), [settings.rev], [] as Task[]) ?? [];
  const subs = useLiveQuery(() => db.subscriptions.toArray(), [settings.rev], []) ?? [];
  const incomes = useLiveQuery(() => db.incomes.toArray(), [settings.rev], [] as IncomeSource[]) ?? [];

  const agenda = agendaFor(today, tasks, subs);
  const openToday = agenda.filter((i) => i.kind === 'task' && i.task && !i.task.doneAt);
  const chargedToday = agenda.filter((i) => i.kind === 'billing');
  const doneToday = agenda.filter((i) => i.kind === 'task' && i.task?.doneAt);
  const todayShown = folded('today') ? openToday.filter((i) => fitsLowDay(i.task!, today)) : openToday;
  const todayFolded = openToday.length - todayShown.length;

  const waiting = stillOpen(tasks, today);
  const waitingFits = folded('waiting') ? waiting.filter((t) => fitsLowDay(t, today)) : waiting;
  const waitingFolded = waiting.length - waitingFits.length;
  const waitingShown = showAllWaiting ? waitingFits : waitingFits.slice(0, WAITING_SHOWN);

  // The most pressing five, not the five most recent - otherwise this and the
  // Backlog tab would disagree about what matters, which is worse than either
  // order on its own. Routines are left out: they are checklists you come back
  // to, kept in their own group on the Backlog, not things waiting for a day.
  const undated = sortTasks(unscheduled(tasks).filter((t) => !t.routine), 'priority');
  const looseFits = folded('loose') ? undated.filter((t) => fitsLowDay(t, today)) : undated;
  const loose = looseFits.slice(0, 5);
  const looseFolded = undated.length - looseFits.length;
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
      {/* First on the screen and in the same place every day, on or off. The
          app never suggests it and never guesses: it has no idea what kind of
          day you are having, and nothing here records that you had one. */}
      {low ? (
        <div className="card card-tight stack-sm" role="status">
          <p className="small">
            <strong>Today is a low day.</strong> Showing what has a time, what is Critical, and what you can do on
            a low day. The rest is folded away, not gone. This ends by itself at midnight.
          </p>
          <div className="btn-row">
            <button type="button" className="btn btn-sm" onClick={() => void endLowDay()}>
              End low day
            </button>
          </div>
        </div>
      ) : (
        <div className="btn-row">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => void startLowDay()}>
            Today is a low day
          </button>
        </div>
      )}

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
          todayShown.length > 0 && (
            <div className="stack-sm">
              {todayShown.map((item) => (
                <TaskRow key={item.key} task={item.task!} onEdit={setEditing} />
              ))}
            </div>
          )
        )}
        {todayFolded > 0 && (
          <FoldedRest
            text={
              todayShown.length > 0
                ? 'Everything else planned for today is folded away.'
                : 'Everything planned for today is folded away.'
            }
            onShow={() => unfold('today')}
          />
        )}

        {/* Money that leaves today is a fact about today, grouped under its
            own quiet heading rather than flagged row by row. */}
        {chargedToday.length > 0 && folded('charged') && (
          <Folded title="Charged today" sub onShow={() => unfold('charged')} />
        )}
        {chargedToday.length > 0 && !folded('charged') && (
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

      {waiting.length > 0 && waitingFits.length === 0 && (
        <Folded title="Still waiting" onShow={() => unfold('waiting')} />
      )}
      {waitingFits.length > 0 && (
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
          {waitingFolded > 0 && (
            <FoldedRest text="Everything else still waiting is folded away." onShow={() => unfold('waiting')} />
          )}
          {/* Always the same three first, and the rest one tap away in the same
              place - never a list whose length decides how the screen looks.
              "All of these" is offered only when all of them are showing, so
              it never acts on something folded out of sight. */}
          <div className="btn-row">
            {waitingFits.length > WAITING_SHOWN && (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                aria-expanded={showAllWaiting}
                onClick={() => setShowAllWaiting((v) => !v)}
              >
                {showAllWaiting ? 'Show fewer' : `Show ${waitingFits.length - WAITING_SHOWN} more`}
              </button>
            )}
            {waiting.length > 1 && waitingFolded === 0 && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => void undateAll(waiting)}>
                Take the dates off all of these (they go to Backlog)
              </button>
            )}
          </div>
        </Section>
      )}

      {paidToday.length > 0 && folded('payday') && <Folded title="Payday" onShow={() => unfold('payday')} />}
      {paidToday.length > 0 && !folded('payday') && (
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

      {bills.length > 0 && folded('bills') && (
        <Folded title={`Money leaving soon (next ${settings.lookaheadDays} days)`} onShow={() => unfold('bills')} />
      )}
      {bills.length > 0 && !folded('bills') && (
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

      {paidSoon.length > 0 && folded('nextPayday') && (
        <Folded title="Next payday" onShow={() => unfold('nextPayday')} />
      )}
      {paidSoon.length > 0 && !folded('nextPayday') && (
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

      {undated.length > 0 && loose.length === 0 && (
        <Folded title="No date on these" onShow={() => unfold('loose')} />
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
          {looseFolded > 0 && (
            <FoldedRest text="Everything else with no date is folded away." onShow={() => unfold('loose')} />
          )}
        </Section>
      )}

      {/* On a low day, the time of what is showing - not of what is folded
          away, which would put back the weight the fold took off. */}
      <p className="faint">
        {todayFolded > 0 ? 'Showing for today' : 'Planned today'}:{' '}
        {describeDuration(todayShown.reduce((sum, i) => sum + (i.task?.durationMin ?? 0), 0))}. This is information,
        not a target.
      </p>
    </>
  );
}

/**
 * A section folded away for a low day: its heading, in its usual place, with
 * "hidden for today" running on inside it and Show beside it. Nothing in it
 * has gone. The note is part of the heading so the two wrap as one line of
 * text at large sizes, and are read out together.
 */
function Folded({ title, sub = false, onShow }: { title: string; sub?: boolean; onShow: () => void }) {
  const Heading = sub ? 'h3' : 'h2';
  const line = (
    <div className="section-head">
      <Heading className="grow">
        {title} <span className="faint folded-note">— hidden for today</span>
      </Heading>
      <button type="button" className="btn btn-quiet btn-sm" aria-label={`Show ${title}`} onClick={onShow}>
        Show
      </button>
    </div>
  );
  if (sub) return line;
  return (
    <section className="stack" aria-label={title}>
      {line}
    </section>
  );
}

/** The part of a list folded away for a low day, in one line under what is showing. */
function FoldedRest({ text, onShow }: { text: string; onShow: () => void }) {
  return (
    <div className="spread">
      <span className="faint grow">{text}</span>
      <button type="button" className="btn btn-quiet btn-sm" onClick={onShow}>
        Show
      </button>
    </div>
  );
}
