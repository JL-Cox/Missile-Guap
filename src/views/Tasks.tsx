import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankTask, db } from '../db';
import type { Settings, Task } from '../types';
import { todayKey } from '../lib/time';
import { sortTasks } from '../lib/priority';
import { groupTasks, taskMatches, type TaskGroup } from '../lib/tasklist';
import TaskRow from '../components/TaskRow';
import TaskEditor from '../components/TaskEditor';
import { useTaskActions } from '../components/taskActions';
import { Empty, Section, Zone, useBackLayer } from '../components/ui';

/**
 * Every task, in four zones: what has a date (today first, then what is
 * coming, then earlier days still open), what has none, what is finished, and
 * a search that looks through all of them.
 *
 * `search` is handed over by Notes - "3 matching tasks - open Tasks" - and
 * lands in the Search zone's box. A new object each time, so it is put in the
 * box even when this page is already open with an editor on it.
 */
export default function Tasks({ settings, search = null }: { settings: Settings; search?: { text: string } | null }) {
  const [query, setQuery] = useState(search?.text ?? '');
  const [editing, setEditing] = useState<Task | null>(null);
  const { remove } = useTaskActions();
  useBackLayer(editing !== null, () => setEditing(null));

  useEffect(() => {
    if (search) setQuery(search.text);
  }, [search]);

  const tasks = useLiveQuery(() => db.tasks.toArray(), [settings.rev], [] as Task[]) ?? [];

  if (editing) {
    const saved = tasks.some((t) => t.id === editing.id);
    return (
      <TaskEditor
        task={editing}
        onSaved={() => setEditing(null)}
        onCancel={() => setEditing(null)}
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

  const today = todayKey();
  const open = tasks.filter((t) => !t.doneAt);
  // Today first, then what is coming, then earlier days - see groupTasks.
  const dated = groupTasks(open.filter((t) => t.date), today);
  // The same ranking the Backlog uses, so the two lists agree about order.
  const undated = sortTasks(open.filter((t) => !t.date), 'priority');
  const finished = groupTasks(tasks.filter((t) => t.doneAt), today, true);

  // Every task, finished ones too: open ones grouped as the list groups them,
  // then what is finished, newest first.
  const needle = query.trim();
  const found = needle
    ? [
        ...groupTasks(open.filter((t) => taskMatches(t, needle)), today),
        ...groupTasks(tasks.filter((t) => t.doneAt && taskMatches(t, needle)), today, true),
      ]
    : [];

  const newTask = (
    <button type="button" className="btn btn-sm" onClick={() => setEditing(blankTask())}>
      New task
    </button>
  );

  /** A group under its own small heading, as the list has always had them. */
  const group = (g: TaskGroup) => (
    <section key={g.key} className="stack-sm" aria-label={g.label}>
      <h3>{g.label}</h3>
      {g.tasks.map((task) => (
        <TaskRow key={task.id} task={task} onEdit={setEditing} showDate={g.showDate} />
      ))}
    </section>
  );

  return (
    <>
      <Zone id="dated">
        <Section title="Has a date" aside={newTask}>
          {dated.length === 0 && (
            <Empty>Nothing has a date yet. Give a task a day and it shows up here, with today first.</Empty>
          )}
        </Section>
        {dated.map(group)}
      </Zone>

      <Zone id="undated">
        <Section title="No date yet" aside={newTask}>
          {undated.length === 0 ? (
            <Empty>
              {open.length > 0
                ? 'Every task has a date. Anything without one shows up here and on your Backlog.'
                : 'Anything without a date shows up here and on your Backlog.'}
            </Empty>
          ) : (
            <div className="stack-sm">
              {undated.map((task) => (
                <TaskRow key={task.id} task={task} onEdit={setEditing} />
              ))}
            </div>
          )}
        </Section>
      </Zone>

      <Zone id="finished">
        <Section title="Finished">
          {finished.length === 0 ? (
            <Empty>Things you tick off are kept here.</Empty>
          ) : (
            <div className="stack-sm">
              {finished[0].tasks.map((task) => (
                <TaskRow key={task.id} task={task} onEdit={setEditing} showDate />
              ))}
            </div>
          )}
        </Section>
      </Zone>

      <Zone id="search">
        <Section title="Search tasks">
          <input
            autoComplete="off"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="A word to look for"
            aria-label="Search tasks"
          />
          {!needle ? (
            <Empty>Type a word to look through every task: titles, notes, steps and tags, finished ones too.</Empty>
          ) : (
            found.length === 0 && (
              <Empty>
                Nothing matches "{needle}". Try a shorter word - search looks in titles, notes, steps and tags.
              </Empty>
            )
          )}
        </Section>
        {found.map(group)}
      </Zone>
    </>
  );
}
