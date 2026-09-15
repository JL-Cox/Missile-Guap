import { useState } from 'react';
import { newId, saveTask } from '../db';
import type { Recurrence, Task } from '../types';
import { atTime, describeDuration, todayKey } from '../lib/time';
import { describeRecurrence } from '../lib/recurrence';
import { ConfirmButton, parseTags, useAutoFocus } from './ui';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DURATIONS = [10, 15, 30, 45, 60, 90, 120];
const REMIND_OFFSETS = [0, 5, 10, 30, 60, 24 * 60];

function offsetLabel(min: number): string {
  if (min === 0) return 'At the time';
  if (min >= 1440) return `${min / 1440} day before`;
  return `${min} min before`;
}

/**
 * Everything here is optional. A task with nothing but a title is a complete,
 * valid task. The form never demands a date, a priority or an estimate, because
 * being made to decide is the thing that stops the task getting written at all.
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
  const titleRef = useAutoFocus<HTMLInputElement>();

  const patch = (changes: Partial<Task>) => setDraft((d) => ({ ...d, ...changes }));

  const setRemindOffset = (minutesBefore: number | null) => {
    if (minutesBefore === null || !draft.date) return patch({ remindAt: undefined, remindedAt: undefined });
    const anchor = draft.startTime ? atTime(draft.date, draft.startTime) : atTime(draft.date, '09:00');
    patch({ remindAt: anchor - minutesBefore * 60_000, remindedAt: undefined });
  };

  const currentOffset = (): number | null => {
    if (draft.remindAt === undefined || !draft.date) return null;
    const anchor = draft.startTime ? atTime(draft.date, draft.startTime) : atTime(draft.date, '09:00');
    return Math.round((anchor - draft.remindAt) / 60_000);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = draft.title.trim();
    if (!title) return;
    const saved = await saveTask({ ...draft, title, tags: parseTags(tagText) });
    onSaved(saved);
  };

  const toggleWeekday = (day: number) => {
    const rec: Recurrence = draft.recurrence ?? { kind: 'weekly', every: 1, weekdays: [] };
    const days = new Set(rec.weekdays ?? []);
    if (days.has(day)) days.delete(day);
    else days.add(day);
    patch({ recurrence: { ...rec, kind: 'weekly', weekdays: [...days].sort((a, b) => a - b) } });
  };

  const offset = currentOffset();

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="field">
        <label htmlFor="task-title">What is it?</label>
        <input
          id="task-title"
          ref={titleRef}
          type="text"
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="Ring the dentist"
        />
      </div>

      <StepsEditor
        steps={draft.steps}
        onChange={(steps) => patch({ steps })}
      />

      <div className="field-row">
        <div className="field">
          <label htmlFor="task-date">Day (optional)</label>
          <input
            id="task-date"
            type="date"
            value={draft.date ?? ''}
            onChange={(e) => patch({ date: e.target.value || undefined })}
          />
        </div>
        <div className="field">
          <label htmlFor="task-time">Time (optional)</label>
          <input
            id="task-time"
            type="time"
            value={draft.startTime ?? ''}
            onChange={(e) => patch({ startTime: e.target.value || undefined })}
            disabled={!draft.date}
          />
        </div>
      </div>

      {!draft.date && (
        <div className="btn-row">
          <button type="button" className="btn btn-sm" onClick={() => patch({ date: todayKey() })}>
            Put it on today
          </button>
        </div>
      )}

      {draft.date && (
        <>
          <div className="field">
            <label>How long do you think it takes?</label>
            <div className="btn-row">
              {DURATIONS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`btn btn-sm${draft.durationMin === d ? ' btn-primary' : ''}`}
                  onClick={() => patch({ durationMin: draft.durationMin === d ? undefined : d })}
                >
                  {describeDuration(d)}
                </button>
              ))}
            </div>
            <p className="faint">An estimate is just an estimate. Nothing checks whether you were right.</p>
          </div>

          <div className="field">
            <label>Remind me</label>
            <div className="btn-row">
              <button
                type="button"
                className={`btn btn-sm${offset === null ? ' btn-primary' : ''}`}
                onClick={() => setRemindOffset(null)}
              >
                Don't remind me
              </button>
              {REMIND_OFFSETS.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`btn btn-sm${offset === m ? ' btn-primary' : ''}`}
                  onClick={() => setRemindOffset(m)}
                >
                  {offsetLabel(m)}
                </button>
              ))}
            </div>
            {!draft.startTime && offset !== null && (
              <p className="faint">No time set, so this counts from 9:00 am on the day.</p>
            )}
          </div>
        </>
      )}

      {!showMore ? (
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShowMore(true)}>
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
                patch({ recurrence: { kind: kind as Recurrence['kind'], every: draft.recurrence?.every ?? 1 } });
              }}
            >
              <option value="none">Doesn't repeat</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="yearly">Every year</option>
            </select>
          </div>

          {draft.recurrence?.kind === 'weekly' && (
            <div className="field">
              <label>On which days?</label>
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
            </div>
          )}

          {draft.recurrence && <p className="faint">{describeRecurrence(draft.recurrence)}.</p>}

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
              id="task-notes"
              value={draft.notes}
              onChange={(e) => patch({ notes: e.target.value })}
              placeholder="Phone number, what to say, where the letter is..."
            />
          </div>

          <div className="field">
            <label htmlFor="task-tags">Tags, separated by commas</label>
            <input
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
        <div className="stack-sm" style={{ marginBottom: 8 }}>
          {steps.map((step) => (
            <div key={step.id} className="row-tight">
              <label className="check grow">
                <input
                  type="checkbox"
                  checked={step.done}
                  onChange={() =>
                    onChange(steps.map((s) => (s.id === step.id ? { ...s, done: !s.done } : s)))
                  }
                />
                <span style={step.done ? { color: 'var(--text-faint)', textDecoration: 'line-through' } : undefined}>
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
