import { useId, useState, type ReactNode } from 'react';
import { db } from '../db';
import type { Task } from '../types';
import { completeTask, describeLastDone, stepProgress, toggleStep, uncompleteTask } from '../lib/tasks';
import { describeDate, describeDuration, timeLabel, todayKey } from '../lib/time';
import { describeRecurrence } from '../lib/recurrence';
import { doneMessage } from '../lib/feedback';
import { undoAction } from '../lib/undo';
import { DetailsButton, TagList, useToast } from './ui';
import { PRIORITY_LABELS, priorityClass } from '../lib/priority';
import AddToCalendar from './AddToCalendar';
import { calendarForTask, icsFilename } from '../lib/ics';

/**
 * A row shows everything true about the task without needing a tap: when it is,
 * how long it might take, how many steps are left. Nothing is hidden behind a
 * long-press or a swipe, because a hidden gesture is a thing to remember - and
 * the details are behind a button that says "Details", not only behind the
 * title, because a title that opens something is also a thing to remember.
 *
 * `actions` are the row's own buttons ("Move to today", "Do it today"). They
 * sit inside the card, so it is never a question which task a button belongs to.
 */
export default function TaskRow({
  task,
  onEdit,
  showDate = false,
  hidePriority = false,
  actions,
}: {
  task: Task;
  onEdit: (task: Task) => void;
  showDate?: boolean;
  /** Set where the list is already grouped under priority headings. */
  hidePriority?: boolean;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const toast = useToast();
  const progress = stepProgress(task);
  const done = Boolean(task.doneAt);

  const tick = async () => {
    if (done) {
      await uncompleteTask(task);
      return;
    }
    // Ticked things usually leave the list they were in, so say what happened
    // and offer it back - a mis-tap should not mean a hunt.
    const after = await completeTask(task);
    toast(doneMessage(after, todayKey()), undoAction(db.tasks, [{ before: task, after }], toast));
  };

  const meta: ReactNode[] = [];
  // First, because it is the thing that decides whether you read the rest of
  // the row. Critical and High are badges; the other two are quiet text.
  if (task.priority && !hidePriority) {
    meta.push(
      <span key="p" className={priorityClass(task.priority)}>
        {PRIORITY_LABELS[task.priority]}
      </span>,
    );
  }
  if (showDate && task.date) meta.push(<span key="d">{describeDate(task.date)}</span>);
  if (task.startTime) meta.push(<span key="t">{timeLabel(task.startTime)}</span>);
  if (task.durationMin) meta.push(<span key="m">{describeDuration(task.durationMin)}</span>);
  if (task.recurrence) meta.push(<span key="r">{describeRecurrence(task.recurrence)}</span>);
  // A repeat rolls forward when ticked, so this is the only place "did I
  // already do it?" can be answered. A fact, never a streak.
  if (task.recurrence && task.lastDoneAt) meta.push(<span key="l">{describeLastDone(task.lastDoneAt)}</span>);
  if (task.energy) meta.push(<span key="e">{task.energy} energy</span>);
  if (progress.total > 0) {
    meta.push(
      <span key="s">
        {progress.done} of {progress.total} steps
      </span>,
    );
  }

  return (
    <div className={`item${done ? ' item-done' : ''}`}>
      {/* The label is the 44px target; the box inside it stays 26px. Styled in
          styles.css rather than inline: an inline accent-color wins over the
          stylesheet, and a finished task could never take the --done colour. */}
      <label className="item-check-hit">
        <input
          type="checkbox"
          className="item-check"
          checked={done}
          aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
          onChange={() => void tick()}
        />
      </label>

      <div className="grow stack-sm">
        <button
          type="button"
          className="item-title item-title-btn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={detailsId}
        >
          {task.title}
        </button>

        <div className="item-foot">
          <div className="stack-sm">
            {meta.length > 0 && <div className="meta">{meta}</div>}
            <TagList tags={task.tags} />
          </div>
          <DetailsButton open={open} onToggle={() => setOpen((v) => !v)} controls={detailsId} />
        </div>

        {open && (
          <div id={detailsId} className="stack-sm">
            {task.notes.trim() && <p className="note-body">{task.notes}</p>}
            {task.steps.map((step) => (
              <label key={step.id} className="check">
                <input type="checkbox" checked={step.done} onChange={() => void toggleStep(task, step.id)} />
                <span className={step.done ? 'step-done' : undefined}>{step.text}</span>
              </label>
            ))}
            <div className="btn-row">
              <button type="button" className="btn btn-sm" onClick={() => onEdit(task)}>
                Edit
              </button>
            </div>
            {task.date && (
              <AddToCalendar
                build={(options) => calendarForTask(task, Date.now(), options)}
                kind="task"
                filename={icsFilename(task.title)}
                nothingToAdd="Give this a day first, then it can go in your calendar."
              />
            )}
          </div>
        )}

        {actions && <div className="btn-row item-actions">{actions}</div>}
      </div>
    </div>
  );
}
