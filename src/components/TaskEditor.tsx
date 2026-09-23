import { useState } from 'react';
import { newId, saveSettings, saveTask } from '../db';
import type { Recurrence, Task } from '../types';
import { describeDuration, todayKey } from '../lib/time';
import { describeRecurrence } from '../lib/recurrence';
import { reminderOffset, withAnchor, withReminder } from '../lib/tasks';
import { notificationSupport, requestPermission, type PermissionState } from '../lib/notify';
import { calendarForTask, icsFilename } from '../lib/ics';
import AddToCalendar from './AddToCalendar';
import { ConfirmButton, DateShortcuts, parseTags, useAutoFocus } from './ui';
import { PRIORITIES, PRIORITY_LABELS } from '../lib/priority';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DURATIONS = [10, 15, 30, 45, 60, 90, 120];
const REMIND_OFFSETS = [0, 5, 10, 30, 60, 24 * 60];
const REPEAT_UNITS: Record<Recurrence['kind'], [string, string]> = {
  daily: ['day', 'days'],
  weekly: ['week', 'weeks'],
  monthly: ['month', 'months'],
  yearly: ['year', 'years'],
};

function offsetLabel(min: number): string {
  if (min === 0) return 'At the time';
  if (min >= 1440) return `${min / 1440} day before`;
  return `${min} min before`;
}

/** "every 2" as typed, read back as a whole number from 1 to 99. */
function readEvery(text: string): number {
  return Math.min(99, Math.max(1, Math.floor(Number(text)) || 1));
}

/**
 * Everything here is optional. A task with nothing but a title is a complete,
 * valid task. The form offers a date, a priority and an estimate and demands
 * none of them, because being made to decide is the thing that stops the task
 * getting written at all. Anything added here has to keep that true: a new
 * field may be offered, never required, and never rendered as missing.
 *
 * The order follows the questions as they come: what, the steps, which day,
 * how long, when to be reminded - and only then how pressing it is, which is a
 * question about the backlog rather than about the task.
 */
export default function TaskEditor({
  task,
  onSaved,
  onCancel,
  onDelete,
}: {
  task: Task;
  onSaved: (task: Task) => void;
  onCancel: () => void;
  onDelete?: (task: Task) => void;
}) {
  const [draft, setDraft] = useState<Task>(task);
  const [tagText, setTagText] = useState(task.tags.join(', '));
  const [showMore, setShowMore] = useState(
    Boolean(task.recurrence || task.energy || task.tags.length || task.notes),
  );
  /*
    Held as the raw text typed, like every number box in this app: a box that
    rewrote itself to "1" the moment it was emptied could not be retyped.
  */
  const [everyText, setEveryText] = useState(String(task.recurrence?.every ?? 1));
  const [permission, setPermission] = useState<PermissionState>(notificationSupport);
  const titleRef = useAutoFocus<HTMLInputElement>();
  const today = todayKey();

  /*
    "Remind me 30 min before" is kept as the 30, not as a moment. The moment is
    worked out from the day and time when you save, so changing either after
    picking a reminder moves the reminder with them, and taking the day off
    takes the reminder off too.
  */
  const [offset, setOffset] = useState<number | null>(() => reminderOffset(task));

  const patch = (changes: Partial<Task>) => setDraft((d) => ({ ...d, ...changes }));

  /** The task as it would be saved right now. */
  const assembled = (): Task => {
    const recurrence = draft.recurrence ? { ...draft.recurrence, every: readEvery(everyText) } : undefined;
    return withAnchor(
      withReminder({ ...draft, recurrence, title: draft.title.trim(), tags: parseTags(tagText) }, offset, task),
      task,
    );
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim()) return;
    onSaved(await saveTask(assembled()));
  };

  const toggleWeekday = (day: number) => {
    const rec: Recurrence = draft.recurrence ?? { kind: 'weekly', every: 1, weekdays: [] };
    const days = new Set(rec.weekdays ?? []);
    if (days.has(day)) days.delete(day);
    else days.add(day);
    patch({ recurrence: { ...rec, kind: 'weekly', weekdays: [...days].sort((a, b) => a - b) } });
  };

  const everyValue = readEvery(everyText);
  const unit = draft.recurrence ? REPEAT_UNITS[draft.recurrence.kind][everyValue === 1 ? 0 : 1] : '';

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="field">
        <label htmlFor="task-title">What is it?</label>
        <input
          autoComplete="off"
          id="task-title"
          ref={titleRef}
          type="text"
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Call the dentist"
        />
      </div>

      <StepsEditor steps={draft.steps} onChange={(steps) => patch({ steps })} />

      <fieldset className="field">
        <legend>Which day? (optional)</legend>
        <DateShortcuts
          value={draft.date}
          today={today}
          label="Which day?"
          noneLabel="No day yet"
          onPick={(date) => patch(date ? { date } : { date: undefined, startTime: undefined })}
        />
        <div className="field-row">
          <div className="field">
            <label htmlFor="task-date">Or pick a date</label>
            <input
              autoComplete="off"
              id="task-date"
              type="date"
              value={draft.date ?? ''}
              onChange={(e) => patch({ date: e.target.value || undefined })}
            />
          </div>
          <div className="field">
            <label htmlFor="task-time">Time (optional)</label>
            <input
              autoComplete="off"
              id="task-time"
              type="time"
              value={draft.startTime ?? ''}
              onChange={(e) => patch({ startTime: e.target.value || undefined })}
              disabled={!draft.date}
            />
          </div>
        </div>
        {!draft.date && <p className="faint">With no day, it goes on your Backlog.</p>}
      </fieldset>

      {draft.date && (
        <>
          <fieldset className="field">
            <legend>How long do you think it takes?</legend>
            <div className="btn-row">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={draft.durationMin === d}
                  className={`btn btn-sm${draft.durationMin === d ? ' btn-primary' : ''}`}
                  onClick={() => patch({ durationMin: draft.durationMin === d ? undefined : d })}
                >
                  {describeDuration(d)}
                </button>
              ))}
            </div>
            <p className="faint">An estimate is just an estimate. Nothing checks whether you were right.</p>
          </fieldset>

          <fieldset className="field">
            <legend>Remind me</legend>
            <div className="btn-row">
              <button
                type="button"
                aria-pressed={offset === null}
                className={`btn btn-sm${offset === null ? ' btn-primary' : ''}`}
                onClick={() => setOffset(null)}
              >
                Don't remind me
              </button>
              {REMIND_OFFSETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={offset === m}
                  className={`btn btn-sm${offset === m ? ' btn-primary' : ''}`}
                  onClick={() => setOffset(m)}
                >
                  {offsetLabel(m)}
                </button>
              ))}
            </div>
            {!draft.startTime && offset !== null && (
              <p className="faint">No time set, so this counts from 9:00 AM on the day.</p>
            )}
            {/* A reminder the phone is not allowed to show is worse than none,
                because you think it is set. Said here, where it is being set. */}
            {offset !== null && permission !== 'granted' && (
              <div className="stack-sm">
                <p className="small">
                  {permission === 'denied'
                    ? "Notifications are blocked for Steady on this phone. They can be turned back on in Chrome's settings for this site."
                    : permission === 'unsupported'
                      ? "This browser can't show notifications."
                      : 'Notifications are off for Steady on this phone.'}
                </p>
                {permission === 'default' && (
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={async () => {
                        setPermission(await requestPermission());
                        await saveSettings({ notificationsAsked: true });
                      }}
                    >
                      Allow notifications
                    </button>
                  </div>
                )}
                <p className="faint">
                  Or add it to your calendar, and your phone reminds you whether or not Steady is open.
                </p>
                <AddToCalendar
                  build={(options) => calendarForTask(assembled(), Date.now(), options)}
                  kind="task"
                  filename={icsFilename(draft.title || 'task')}
                  nothingToAdd="Give this a day first, then it can go in your calendar."
                />
              </div>
            )}
          </fieldset>
        </>
      )}

      {/* Offered, never demanded - see the note at the top of this file. Tapping
          the level it already has clears it, so "actually I don't know" is one
          tap rather than a trip through a menu. */}
      <fieldset className="field">
        <legend>How pressing is it?</legend>
        <div className="btn-row">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={draft.priority === p}
              className={`btn btn-sm${draft.priority === p ? ' btn-primary' : ''}`}
              onClick={() => patch({ priority: draft.priority === p ? undefined : p })}
            >
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>
        <p className="faint">
          Only used to sort your backlog. Leave it alone if you would rather not decide - that is a normal
          answer, and nothing is treated as late either way.
        </p>
      </fieldset>

      {!showMore ? (
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          aria-expanded={false}
          onClick={() => setShowMore(true)}
        >
          More options (repeat, notes, tags)
        </button>
      ) : (
        <>
          <hr className="divider" />

          <div className="field">
            <label htmlFor="task-repeat">Repeats</label>
            <select
              id="task-repeat"
              value={draft.recurrence?.kind ?? 'none'}
              onChange={(e) => {
                const kind = e.target.value;
                if (kind === 'none') return patch({ recurrence: undefined });
                patch({ recurrence: { kind: kind as Recurrence['kind'], every: everyValue } });
              }}
            >
              <option value="none">Doesn't repeat</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
            {draft.recurrence && !draft.date && (
              // Ticking a repeat off rolls it to its next date - which needs a
              // date to roll from. Without one it just completes, so say so here
              // rather than letting a repeat quietly stop after the first time.
              <p className="faint">
                A repeat needs a day to repeat from. Give it one above, or this will simply finish when you
                tick it off.
              </p>
            )}
          </div>

          {draft.recurrence && (
            <div className="field">
              <div className="row-tight">
                <label htmlFor="task-every" className="inline-label">
                  Every
                </label>
                <input
                  autoComplete="off"
                  id="task-every"
                  type="text"
                  inputMode="numeric"
                  className="input-narrow"
                  value={everyText}
                  onChange={(e) => setEveryText(e.target.value)}
                  aria-describedby="task-every-unit"
                />
                <span id="task-every-unit">{unit}</span>
              </div>
              <p className="faint">Leave it at 1 for every single one. 2 is every other.</p>
            </div>
          )}

          {draft.recurrence?.kind === 'weekly' && (
            <fieldset className="field">
              <legend>On which days?</legend>
              <div className="btn-row">
                {WEEKDAY_LABELS.map((label, day) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={draft.recurrence?.weekdays?.includes(day) ?? false}
                    className={`btn btn-sm${draft.recurrence?.weekdays?.includes(day) ? ' btn-primary' : ''}`}
                    onClick={() => toggleWeekday(day)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {draft.recurrence && (
            <p className="faint">{describeRecurrence({ ...draft.recurrence, every: everyValue })}.</p>
          )}

          <div className="field">
            <label htmlFor="task-energy">How much does this take out of you?</label>
            <select
              id="task-energy"
              value={draft.energy ?? ''}
              onChange={(e) => patch({ energy: (e.target.value || undefined) as Task['energy'] })}
            >
              <option value="">Not saying</option>
              <option value="low">Low - can do it tired</option>
              <option value="medium">Medium</option>
              <option value="high">High - needs a good day</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="task-notes">Notes</label>
            <textarea
              autoComplete="off"
              id="task-notes"
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Phone number, what to say, where the letter is..."
            />
          </div>

          <div className="field">
            <label htmlFor="task-tags">Tags, separated by commas</label>
            <input
              autoComplete="off"
              id="task-tags"
              type="text"
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder="health, admin"
            />
          </div>
        </>
      )}

      <div className="spread">
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={!draft.title.trim()}>
            Save
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
        {onDelete && (
          <ConfirmButton
            label="Delete"
            confirmLabel="Yes, delete it"
            className="btn btn-quiet btn-sm"
            onConfirm={() => onDelete(draft)}
          />
        )}
      </div>
    </form>
  );
}

/**
 * Breaking one overwhelming thing into steps small enough to start is the
 * single most useful feature here, so it sits in the main form, not behind
 * "more options".
 */
function StepsEditor({ steps, onChange }: { steps: Task['steps']; onChange: (steps: Task['steps']) => void }) {
  const [text, setText] = useState('');

  const add = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onChange([...steps, { id: newId(), text: trimmed, done: false }]);
    setText('');
  };

  return (
    <div className="field">
      <label htmlFor="task-step">Break it into steps (optional)</label>
      {steps.length > 0 && (
        <div className="stack-sm">
          {steps.map((step) => (
            <div key={step.id} className="row-tight step-row">
              <label className="check grow">
                <input
                  type="checkbox"
                  checked={step.done}
                  onChange={() =>
                    onChange(steps.map((s) => (s.id === step.id ? { ...s, done: !s.done } : s)))
                  }
                />
                <span className={step.done ? 'step-done' : undefined}>
                  {step.text}
                </span>
              </label>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => onChange(steps.filter((s) => s.id !== step.id))}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="row-tight">
        <input
          autoComplete="off"
          id="task-step"
          type="text"
          className="grow"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="First small thing..."
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn-sm" onClick={add} disabled={!text.trim()}>
          Add step
        </button>
      </div>
    </div>
  );
}
