import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankTask, db, saveSettings } from '../db';
import type { BacklogSort, Priority, Settings, Task } from '../types';
import { deleteTask, moveTo } from '../lib/tasks';
import { finishedWithoutDate, unscheduled } from '../lib/agenda';
import { groupLabel, PRIORITIES, sortTasks, SORTS } from '../lib/priority';
import { todayKey } from '../lib/time';
import TaskRow from '../components/TaskRow';
import TaskEditor from '../components/TaskEditor';
import { Empty, Section } from '../components/ui';

/**
 * Everything that needs doing and has no day on it.
 *
 * Booking the appointment, ordering the thing, chasing the letter - the jobs
 * that are not urgent enough to schedule and not small enough to forget, which
 * is exactly why they go missing. They are ordinary tasks; the only thing that
 * puts them here is that nobody has given them a date, so nothing new has to be
 * decided when you write one down.
 *
 * Giving one a day is how it leaves. Nothing here is late, nothing is counted,
 * and the list never tells you how long something has been sitting.
 */
export default function Backlog({
  settings,
  onChange,
}: {
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const [editing, setEditing] = useState<Task | null>(null);
  const [showFinished, setShowFinished] = useState(false);

  const tasks = useLiveQuery(() => db.tasks.toArray(), [settings.rev], [] as Task[]) ?? [];

  if (editing) {
    return (
      <TaskEditor
        task={editing}
        onSaved={() => setEditing(null)}
        onCancel={() => setEditing(null)}
        onDelete={async (t) => {
          await deleteTask(t);
          setEditing(null);
        }}
      />
    );
  }

  const sort = settings.backlogSort;
  const open = sortTasks(unscheduled(tasks), sort);
  const finished = finishedWithoutDate(tasks);
  const today = todayKey();

  /*
    Under the default order the list carries a quiet heading per level, so you
    can see where Critical stops. The other three orders are one flat run - a
    heading there would be sorting the list by one thing and labelling it by
    another.
  */
  const grouped: { key: string; items: Task[] }[] = [];
  if (sort === 'priority') {
    for (const level of [...PRIORITIES, undefined] as (Priority | undefined)[]) {
      const items = open.filter((t) => t.priority === level);
      if (items.length > 0) grouped.push({ key: groupLabel(level), items });
    }
  }

  return (
    <>
      <Section
        title="Backlog"
        aside={
          <button type="button" className="btn btn-sm" onClick={() => setEditing(blankTask())}>
            Add something
          </button>
        }
      >
        <p className="faint">
          Things to get to when you can. Nothing here has a day on it, and nothing here is late.
        </p>
        <div className="btn-row" role="group" aria-label="Sort the backlog">
          {SORTS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={sort === s.id}
              className={`btn btn-sm${sort === s.id ? ' btn-primary' : ''}`}
              // Saved rather than held in the component, so the list opens the
              // way you left it rather than resetting every time you come back.
              onClick={() => void saveSettings({ backlogSort: s.id as BacklogSort }).then(onChange)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </Section>

      {open.length === 0 ? (
        <Empty>
          Nothing outstanding. Anything you write down without giving it a day turns up here.
        </Empty>
      ) : sort === 'priority' ? (
        grouped.map(({ key, items }) => (
          <section key={key} className="stack-sm" aria-label={key}>
            <h3 className="muted">{key}</h3>
            {items.map((task) => (
              <BacklogRow key={task.id} task={task} today={today} onEdit={setEditing} />
            ))}
          </section>
        ))
      ) : (
        <div className="stack-sm">
          {open.map((task) => (
            <BacklogRow key={task.id} task={task} today={today} onEdit={setEditing} />
          ))}
        </div>
      )}

      {finished.length > 0 && (
        <Section title="Finished">
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            aria-expanded={showFinished}
            onClick={() => setShowFinished((v) => !v)}
          >
            {showFinished ? 'Hide what I have finished' : `Show what I have finished (${finished.length})`}
          </button>
          {showFinished && (
            <div className="stack-sm">
              {finished.map((task) => (
                <TaskRow key={task.id} task={task} onEdit={setEditing} />
              ))}
            </div>
          )}
        </Section>
      )}
    </>
  );
}

/**
 * A backlog row is an ordinary task row plus the one action that actually moves
 * something along: giving it today. Same button and same words as the Today
 * screen uses, because it does the same thing.
 */
function BacklogRow({
  task,
  today,
  onEdit,
}: {
  task: Task;
  today: string;
  onEdit: (task: Task) => void;
}) {
  return (
    <div className="stack-sm">
      <TaskRow task={task} onEdit={onEdit} />
      <div className="btn-row">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => void moveTo(task, today)}>
          Do it today
        </button>
      </div>
    </div>
  );
}
