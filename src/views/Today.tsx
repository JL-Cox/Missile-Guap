import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, blankTask, forgetSettings, saveSettings } from '../db';
import type { DateKey, IncomeSource, Settings, Subscription, Task } from '../types';
import { agendaFor, stillOpen, unscheduled, upcomingBills, upcomingPayments } from '../lib/agenda';
import { paydaysFrom } from '../lib/cashflow';
import { fitsLowDay, isLowDay, isStaleLowDay } from '../lib/lowday';
import { sortTasks } from '../lib/priority';
import { describeDate, describeDuration, fromDateKey, shortDate, SHORT_WEEKDAYS, todayKey } from '../lib/time';
import { formatMoney } from '../lib/money';
import { countOf, cutTitle, nameList } from '../lib/sections';
import { chargesAndPayments } from '../lib/debtwords';
import TaskRow from '../components/TaskRow';
import TaskEditor from '../components/TaskEditor';
import { useTaskActions } from '../components/taskActions';
import { useDebtPlan } from '../components/useDebtPlan';
import { Amount, Empty, FoldHeader, Section, Zone, useBackLayer, useNavigate, useZone } from '../components/ui';

/** How many waiting tasks show before "Show N more" - the same number every day. */
const WAITING_SHOWN = 3;
/** How many upcoming charges and payments fit before the list says there are more. */
const BILLS_SHOWN = 6;

const NO_SUBS: Subscription[] = [];
const NO_INCOMES: IncomeSource[] = [];
/** How many of the backlog's top things "No date on these" shows. */
const LOOSE_SHOWN = 5;

/**
 * Which folded parts have been opened on a low day. Held in memory only, never
 * saved: they stay open while you move between pages, and a reload - or
 * tomorrow - folds them away again.
 */
let peeked: { day: DateKey; keys: string[] } = { day: '', keys: [] };

/** Where a section a low day can fold whole stands right now. */
type LowDayFold = 'off' | 'folded' | 'peeked';

/**
 * The one page to open when you cannot face opening anything. Fixed order,
 * every single day, in four zones: Today - what is happening today, and a
 * line about each of the other three - then what is still waiting, what money
 * is about to move, and what has no date. Never a different layout depending
 * on what's in it: every zone is always there, and an empty one says what it
 * is for.
 *
 * Today always opens on its first zone, so "Today" means today.
 *
 * On a low day it is the same page, quieter: every section stays where it
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
  const navigate = useNavigate();
  const zone = useZone();
  useBackLayer(editing !== null, () => setEditing(null));

  const low = isLowDay(settings, today);
  /** Whether a part of the page is folded away for the low day right now. */
  const folded = (key: string) => low && !shown.includes(key);
  const unfold = (key: string) => {
    const keys = [...shown, key];
    peeked = { day: today, keys };
    setShown(keys);
  };
  const refold = (key: string) => {
    const keys = shown.filter((k) => k !== key);
    peeked = { day: today, keys };
    setShown(keys);
  };
  /**
   * A section a low day folds whole: off a low day, or when something in it
   * fits a low day, it is an ordinary section. Otherwise it is folded, unless
   * you opened it today. `whole` is false for a section with nothing in it,
   * because there is nothing to hide.
   */
  const lowFold = (key: string, whole: boolean): LowDayFold =>
    !low || !whole ? 'off' : shown.includes(key) ? 'peeked' : 'folded';

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
  const subs = useLiveQuery(() => db.subscriptions.toArray(), [settings.rev], NO_SUBS) ?? NO_SUBS;
  const incomes = useLiveQuery(() => db.incomes.toArray(), [settings.rev], NO_INCOMES) ?? NO_INCOMES;
  // The debt plan's dated payments, the same ones Money and the Debt page show.
  const { view: debtView } = useDebtPlan(settings, incomes, subs, today);

  const agenda = agendaFor(today, tasks, subs, debtView.payments);
  const openToday = agenda.filter((i) => i.kind === 'task' && i.task && !i.task.doneAt);
  // Charges and debt payments together: "going out", which is true of both,
  // where "charged" was only true of a subscription.
  const goingOutToday = agenda.filter((i) => i.kind === 'billing' || i.kind === 'payment');
  const doneToday = agenda.filter((i) => i.kind === 'task' && i.task?.doneAt);
  const todayShown = folded('today') ? openToday.filter((i) => fitsLowDay(i.task!, today)) : openToday;
  const todayFolded = openToday.length - todayShown.length;

  const waiting = stillOpen(tasks, today);
  const waitingFits = folded('waiting') ? waiting.filter((t) => fitsLowDay(t, today)) : waiting;
  const waitingFolded = waiting.length - waitingFits.length;
  const waitingShown = showAllWaiting ? waitingFits : waitingFits.slice(0, WAITING_SHOWN);

  // The most pressing five, not the five most recent - otherwise this and the
  // Backlog would disagree about what matters, which is worse than either
  // order on its own. Routines are left out: they are checklists you come back
  // to, kept in their own zone on the Backlog, not things waiting for a day.
  const undated = sortTasks(unscheduled(tasks).filter((t) => !t.routine), 'priority');
  const looseFits = folded('loose') ? undated.filter((t) => fitsLowDay(t, today)) : undated;
  const loose = looseFits.slice(0, LOOSE_SHOWN);
  const looseFolded = undated.length - looseFits.length;
  const bills = upcomingBills(subs, settings.lookaheadDays, today).filter((b) => b.inDays > 0);
  const duePayments = upcomingPayments(debtView.payments, settings.lookaheadDays, today).filter((p) => p.inDays > 0);
  // One list, soonest first: a payment is "<name> payment", so it is never
  // mistaken for a subscription.
  const leaving = [
    ...bills.map((b) => ({
      key: `bill-${b.sub.id}-${b.date}`,
      title: b.sub.name,
      date: b.date,
      amountMinor: b.sub.amountMinor,
      currency: b.sub.currency,
      autopay: false,
    })),
    ...duePayments.map((p) => ({
      key: `payment-${p.debt.id}-${p.date}`,
      title: `${p.debt.name} payment`,
      date: p.date,
      amountMinor: p.amountMinor,
      currency: p.debt.currency,
      autopay: p.debt.autopay,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
  // A payday check the debt plan puts extra from, for one quiet line under Payday.
  const paydayCheck = debtView.checks.find((c) => c.period.start === today && c.extraMinor > 0);

  // "Can this wait until I get paid?" is only answerable if payday is on screen.
  // The monthly figure counts every job, including one paid today.
  const { today: paidToday, soon: paidSoon, monthlyMinor: monthlyFromAll } = paydaysFrom(incomes, today);

  /*
    What a low day folds whole. Still waiting and No date on these fold whole
    only when nothing in them fits a low day; otherwise just the rows that do
    not fit fold, to one line under the rest. Money is never on a low day's
    list, so everything about it folds whole. Opening one is for today only
    and saves nothing; its heading then says Hide, which folds it back.
  */
  const waitingFold = lowFold('waiting', waiting.length > 0 && !waiting.some((t) => fitsLowDay(t, today)));
  const looseFold = lowFold('loose', undated.length > 0 && !undated.some((t) => fitsLowDay(t, today)));
  const chargedFold = lowFold('charged', goingOutToday.length > 0);
  const paydayFold = lowFold('payday', paidToday.length > 0);
  const billsFold = lowFold('bills', leaving.length > 0);
  const nextPaydayFold = lowFold('nextPayday', paidSoon.length > 0);

  const billsMinor = leaving.reduce((sum, b) => sum + b.amountMinor, 0);
  const leavingWords = chargesAndPayments(bills.length, duePayments.length, 'payment');
  // With amounts blurred the line leaves the amount out rather than blurring
  // it, because a tappable blurred amount cannot sit inside a button.
  const billsSummary = settings.blurAmounts
    ? leavingWords
    : leaving.length === 1
      ? `${leavingWords}, ${formatMoney(billsMinor, settings.currency)}`
      : `${leavingWords}, ${formatMoney(billsMinor, settings.currency)} in all`;
  const nextPay = paidSoon[0];
  const paydaySummary = nextPay
    ? `${cutTitle(nextPay.source.name)}, ${SHORT_WEEKDAYS[fromDateKey(nextPay.date).getDay()]}, ${shortDate(nextPay.date, today)}${
        paidSoon.length > 1 ? `, and ${paidSoon.length - 1} more` : ''
      }`
    : '';
  const looseCount = Math.min(LOOSE_SHOWN, undated.length);
  const looseSummary = looseCount === 1 ? 'The top one from your backlog' : `The top ${looseCount} from your backlog`;

  /*
    "More on Today": one line for each of the other zones, at the end of the
    first, so what is waiting and what money is about to move are still in
    the one glance. Always three rows, whatever is in them. A zone the low
    day has folded says so, and nothing more.
  */
  const HIDDEN = 'Hidden for today';
  // Hidden when there is money to show and all of it is folded.
  const moneyHidden =
    (leaving.length > 0 || paidSoon.length > 0) &&
    (leaving.length === 0 || billsFold === 'folded') &&
    (paidSoon.length === 0 || nextPaydayFold === 'folded');
  const signposts = [
    {
      zone: 'waiting',
      title: 'Waiting',
      summary:
        waitingFold === 'folded'
          ? HIDDEN
          : waiting.length > 0
            ? `${countOf(waiting.length, 'task', 'tasks')} still here`
            : 'Nothing waiting',
    },
    {
      zone: 'money',
      title: 'Money',
      summary: moneyHidden
        ? HIDDEN
        : leaving.length > 0
          ? billsSummary
          : nextPay
            ? `Next payday: ${paydaySummary}`
            : `Nothing in the next ${settings.lookaheadDays} days`,
    },
    {
      zone: 'undated',
      title: 'No date',
      summary: looseFold === 'folded' ? HIDDEN : undated.length > 0 ? looseSummary : 'Nothing without a date',
    },
  ];

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
      <Zone id="day">
        {/* First on the page and in the same place every day, on or off. The
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
          {openToday.length === 0 && goingOutToday.length === 0 ? (
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
          {goingOutToday.length > 0 && (
            <LowDaySection
              title="Going out today"
              name="charged"
              fold={chargedFold}
              onShow={() => unfold('charged')}
              onHide={() => refold('charged')}
              sub
            >
              {goingOutToday.map((item) => (
                <div key={item.key} className="item">
                  <div className="figure grow">
                    <span className="item-title">{item.subscription?.name ?? item.title}</span>
                    <Amount
                      className="figure-value"
                      text={formatMoney(
                        item.amountMinor ?? 0,
                        item.subscription?.currency ?? item.debt?.currency ?? settings.currency,
                      )}
                      blur={settings.blurAmounts}
                    />
                  </div>
                </div>
              ))}
            </LowDaySection>
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

        {/* On a low day, the time of what is showing - not of what is folded
            away, which would put back the weight the fold took off. */}
        <p className="faint">
          {todayFolded > 0 ? 'Showing for today' : 'Planned today'}:{' '}
          {describeDuration(todayShown.reduce((sum, i) => sum + (i.task?.durationMin ?? 0), 0))}. This is
          information, not a target.
        </p>

        {/* Payday is good news and one line long, so only a low day folds it,
            like the rest of the money. */}
        {paidToday.length > 0 && (
          <LowDaySection
            title="Payday"
            name="payday"
            fold={paydayFold}
            onShow={() => unfold('payday')}
            onHide={() => refold('payday')}
          >
            <div className="stack-sm">
              {paidToday.map(({ source: src }) => (
                <div key={src.id} className="item">
                  <div className="figure grow">
                    <div>
                      <div className="item-title">{src.name}</div>
                      <div className="faint">Should land today</div>
                    </div>
                    <Amount
                      className="figure-value"
                      text={formatMoney(src.netMinor, src.currency)}
                      blur={settings.blurAmounts}
                    />
                  </div>
                </div>
              ))}
            </div>
            {paydayCheck && (
              <div className="spread">
                <span className="faint grow">
                  Your debt plan puts{' '}
                  <Amount text={formatMoney(paydayCheck.extraMinor, settings.currency)} blur={settings.blurAmounts} />{' '}
                  extra toward {nameList(paydayCheck.extra.map((e) => e.debt.name))} from this one.
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => navigate('debt', { zone: 'paychecks' })}
                >
                  Open Debt
                </button>
              </div>
            )}
          </LowDaySection>
        )}

        <section className="stack-sm" aria-label="More on Today">
          <h2>More on Today</h2>
          <div className="card card-rows">
            {signposts.map((s, i) => (
              <Fragment key={s.zone}>
                {i > 0 && <hr className="divider" />}
                <button
                  type="button"
                  className="fold-btn signpost"
                  data-zone={s.zone}
                  onClick={() => zone?.choose(s.zone, true)}
                >
                  <span>
                    <span className="fold-title">{s.title}</span>{' '}
                    <span className="fold-summary">{s.summary}</span>
                  </span>
                  <span className="fold-state" aria-hidden="true">
                    Open ›
                  </span>
                </button>
              </Fragment>
            ))}
          </div>
        </section>
      </Zone>

      <Zone id="waiting">
        <LowDaySection
          title="Still waiting"
          name="waiting"
          fold={waitingFold}
          onShow={() => unfold('waiting')}
          onHide={() => refold('waiting')}
        >
          {waiting.length === 0 ? (
            <Empty>
              Nothing is waiting. A task from an earlier day that is not finished shows up here. It is not late, it
              is just still here.
            </Empty>
          ) : (
            <>
              <p className="faint">
                These had an earlier date and are not finished. They are not late, they are just still here.
              </p>
              {waitingShown.length > 0 && (
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
                          <button
                            type="button"
                            className="btn btn-quiet btn-sm"
                            onClick={() => void move(task, undefined)}
                          >
                            Take the date off
                          </button>
                        </>
                      }
                    />
                  ))}
                </div>
              )}
              {waitingFolded > 0 && (
                <FoldedRest text="Everything else still waiting is folded away." onShow={() => unfold('waiting')} />
              )}
              {/* Always the same three first, and the rest one tap away in the same
                  place - never a list whose length decides how the page looks.
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
            </>
          )}
        </LowDaySection>
      </Zone>

      <Zone id="money">
        <LowDaySection
          title={`Money leaving soon (next ${settings.lookaheadDays} days)`}
          name="bills"
          fold={billsFold}
          onShow={() => unfold('bills')}
          onHide={() => refold('bills')}
        >
          {leaving.length === 0 ? (
            <Empty>
              {paidSoon.length === 0
                ? `Money leaving in the next ${settings.lookaheadDays} days shows up here, and so does your next payday. Add subscriptions and income on the Money page.`
                : `Nothing is leaving in the next ${settings.lookaheadDays} days.`}
            </Empty>
          ) : (
            <>
              <div className="stack-sm">
                {leaving.slice(0, BILLS_SHOWN).map((b) => (
                  <div key={b.key} className="item">
                    <div className="figure grow">
                      <div>
                        <div className="item-title">{b.title}</div>
                        <div className="faint">
                          {describeDate(b.date, today)}
                          {b.autopay ? ' · autopay' : ''}
                        </div>
                      </div>
                      <Amount
                        className="figure-value"
                        text={formatMoney(b.amountMinor, b.currency)}
                        blur={settings.blurAmounts}
                      />
                    </div>
                  </div>
                ))}
              </div>
              {leaving.length > BILLS_SHOWN && (
                <p className="faint">
                  {leaving.length - BILLS_SHOWN} more on the{' '}
                  {duePayments.length > 0 ? 'Money and Debt pages' : 'Money page'}.
                </p>
              )}
            </>
          )}
        </LowDaySection>

        {paidSoon.length > 0 && (
          <LowDaySection
            title="Next payday"
            name="nextPayday"
            fold={nextPaydayFold}
            onShow={() => unfold('nextPayday')}
            onHide={() => refold('nextPayday')}
          >
            <div className="stack-sm">
              {paidSoon.map(({ source: src, date }) => (
                <div key={src.id} className="item">
                  <div className="figure grow">
                    <div>
                      <div className="item-title">{src.name}</div>
                      <div className="faint">{describeDate(date, today)}</div>
                    </div>
                    <Amount
                      className="figure-value"
                      text={formatMoney(src.netMinor, src.currency)}
                      blur={settings.blurAmounts}
                    />
                  </div>
                </div>
              ))}
            </div>
            <p className="faint">
              Weekends and the holidays you set for each job are already accounted for. About{' '}
              <Amount text={formatMoney(monthlyFromAll, settings.currency)} blur={settings.blurAmounts} /> a month
              between them.
            </p>
          </LowDaySection>
        )}
      </Zone>

      <Zone id="undated">
        <LowDaySection
          title="No date on these"
          name="loose"
          fold={looseFold}
          onShow={() => unfold('loose')}
          onHide={() => refold('loose')}
        >
          {undated.length === 0 ? (
            <Empty>
              Nothing without a date. Anything you write down without a day goes to your Backlog, and the top five
              show up here.
            </Empty>
          ) : (
            <>
              <p className="faint">
                The ones nearest the top of your backlog. Give one a day only if you want to.
              </p>
              {loose.length > 0 && (
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
              )}
              {looseFolded > 0 && (
                <FoldedRest text="Everything else with no date is folded away." onShow={() => unfold('loose')} />
              )}
              {undated.length > LOOSE_SHOWN && (
                <div className="spread">
                  <span className="faint grow">The rest are on your Backlog.</span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => navigate('backlog', { zone: 'open' })}
                  >
                    Open Backlog
                  </button>
                </div>
              )}
            </>
          )}
        </LowDaySection>
      </Zone>
    </>
  );
}

/**
 * A part of Today that a low day can fold whole. Off a low day it is an
 * ordinary section. Folded, its heading stays in its usual place, with
 * "Hidden for today" under it and Show beside it, drawn by the same
 * FoldHeader as every other folded section so the two look and read alike.
 * Show opens it for today only - nothing in it has gone - and its heading then
 * says Hide, which folds it back. Neither is saved.
 *
 * `sub` is for "Going out today", a small heading inside the Today section.
 */
function LowDaySection({
  title,
  name,
  fold,
  onShow,
  onHide,
  sub = false,
  children,
}: {
  title: string;
  /** The low day's own word for this part, which makes its body's id. */
  name: string;
  fold: LowDayFold;
  onShow: () => void;
  onHide: () => void;
  sub?: boolean;
  children: ReactNode;
}) {
  if (fold === 'off') {
    if (!sub) return <Section title={title}>{children}</Section>;
    return (
      <div className="stack-sm">
        <h3>{title}</h3>
        {children}
      </div>
    );
  }

  const open = fold === 'peeked';
  const bodyId = `low-day-${name}`;
  // `controls` only while open: folded, nothing is drawn under the heading.
  const heading = (
    <FoldHeader
      title={title}
      summary="Hidden for today"
      open={open}
      onToggle={open ? onHide : onShow}
      controls={open ? bodyId : undefined}
      level={sub ? 3 : 2}
    />
  );
  if (sub) {
    if (!open) return heading;
    return (
      <div className="stack-sm">
        {heading}
        <div id={bodyId} className="stack-sm">
          {children}
        </div>
      </div>
    );
  }
  return (
    <section className="stack" aria-label={title}>
      {heading}
      {open && (
        <div id={bodyId} className="stack">
          {children}
        </div>
      )}
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
