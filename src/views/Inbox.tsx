import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankNote, blankTask, clearCapture, db, saveNote, unclearCapture } from '../db';
import type { Capture, Note, Settings, Task } from '../types';
import TaskEditor from '../components/TaskEditor';
import { Empty, Section } from '../components/ui';
import TagSuggestions, { useSuggestions, useTagModel } from '../components/TagSuggestions';
import { undoFiling } from '../lib/inbox';

/**
 * Where everything you typed into the capture box lands. Three buttons per
 * item, always the same three, so emptying the inbox is a mechanical action
 * rather than a series of judgement calls.
 */
export default function Inbox({ settings }: { settings: Settings }) {
  const [editing, setEditing] = useState<{ task: Task; captureId: string } | null>(null);
  const [showCleared, setShowCleared] = useState(false);
  const [lastCleared, setLastCleared] = useState<Capture | null>(null);
  /**
   * The note just filed, kept up to date as tags are added here, so it can be
   * offered tags without adding a step - and so "Put it back" knows which
   * note to take away again.
   */
  const [justFiled, setJustFiled] = useState<Note | null>(null);
  /** A quiet line saying what "Put it back" did with the note, when it kept it. */
  const [undoNotice, setUndoNotice] = useState('');
  const model = useTagModel();
  const suggestions = useSuggestions(
    model,
    justFiled ? `${justFiled.title}\n${justFiled.body}` : '',
    justFiled?.tags ?? [],
  );

  const all = useLiveQuery(() => db.captures.orderBy('createdAt').reverse().toArray(), [settings.rev], []) ?? [];
  const open = all.filter((c) => !c.clearedAt);
  const cleared = all.filter((c) => c.clearedAt);

  const toTask = (capture: Capture) => {
    setEditing({ task: blankTask({ title: capture.text }), captureId: capture.id });
  };

  const putBack = async () => {
    if (!lastCleared) return;
    await unclearCapture(lastCleared.id);
    // A capture kept as a note comes back without its note, so filing it again
    // does not leave two. A note changed since is left alone.
    if (justFiled && !(await undoFiling(justFiled))) {
      setUndoNotice('The note made from it is still in Notes, because it has been changed since.');
    } else {
      setUndoNotice('');
    }
    setLastCleared(null);
    setJustFiled(null);
  };

  const toNote = async (capture: Capture) => {
    const firstLine = capture.text.split('\n')[0].slice(0, 80);
    // Filing stays a single tap. Tags are offered afterwards, on the panel
    // below, so nothing is added to the fastest path through this screen.
    const saved = await saveNote(blankNote({ title: firstLine, body: capture.text }));
    await clearCapture(capture.id);
    setLastCleared(capture);
    setJustFiled(saved);
    setUndoNotice('');
  };

  const dismiss = async (capture: Capture) => {
    await clearCapture(capture.id);
    setLastCleared(capture);
    setJustFiled(null);
    setUndoNotice('');
  };

  if (editing) {
    return (
      <TaskEditor
        task={editing.task}
        onSaved={async () => {
          await clearCapture(editing.captureId);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <>
      <Section title={open.length > 0 ? `Inbox (${open.length})` : 'Inbox'}>
        {open.length === 0 ? (
          <Empty>
            The inbox is clear. Whatever you type in the box at the top of any screen arrives here, and you deal
            with it whenever you feel like it.
          </Empty>
        ) : (
          <div className="stack-sm">
            {open.map((capture) => (
              <div key={capture.id} className="card card-tight stack-sm">
                <p style={{ whiteSpace: 'pre-wrap' }}>{capture.text}</p>
                <p className="faint">
                  Written {new Date(capture.createdAt).toLocaleString(undefined, {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <div className="btn-row">
                  <button type="button" className="btn btn-sm" onClick={() => toTask(capture)}>
                    Make it a task
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => void toNote(capture)}>
                    Keep as a note
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => void dismiss(capture)}>
                    Done with it
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      {lastCleared && (
        <div className="card card-quiet stack-sm">
          <div className="spread">
            <span className="small">Cleared "{lastCleared.text.slice(0, 40)}".</span>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => void putBack()}
            >
              Put it back
            </button>
          </div>
          {settings.suggestTags && justFiled && (
            <TagSuggestions
              suggestions={suggestions}
              onAdd={async (tag) => {
                const next = await saveNote({ ...justFiled, tags: [...justFiled.tags, tag] });
                setJustFiled(next);
              }}
            />
          )}
        </div>
      )}

      {undoNotice && <p className="faint">{undoNotice}</p>}

      {cleared.length > 0 && (
        <Section title="Already dealt with">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShowCleared((v) => !v)}>
            {showCleared ? 'Hide' : 'Show'} {cleared.length} cleared
          </button>
          {showCleared && (
            <div className="stack-sm">
              {cleared.slice(0, 50).map((capture) => (
                <div key={capture.id} className="item">
                  <span className="grow muted small" style={{ whiteSpace: 'pre-wrap' }}>
                    {capture.text}
                  </span>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => void unclearCapture(capture.id)}>
                    Put it back
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="faint">Nothing is ever deleted when you clear it. It just moves down here.</p>
        </Section>
      )}
    </>
  );
}
