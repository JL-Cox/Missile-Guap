import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankNote, blankTask, clearCapture, db, saveNote, unclearCapture } from '../db';
import type { Capture, Note, Settings, Task } from '../types';
import TaskEditor from '../components/TaskEditor';
import { Empty, Section, useBackLayer, useToast } from '../components/ui';
import TagSuggestions, { useSuggestions, useTagModel } from '../components/TagSuggestions';
import { splitCapture, undoFiling } from '../lib/inbox';
import { savedTaskWhere } from '../lib/feedback';
import { shortDateTime } from '../lib/time';

/**
 * Where everything you typed into the capture box lands. Three buttons per
 * item, always the same three, so emptying the inbox is a mechanical action
 * rather than a series of judgement calls.
 *
 * Each of the three says where the thing went, and the two that clear it offer
 * Undo in the same toast every other screen uses.
 */
export default function Inbox({ settings }: { settings: Settings }) {
  const [editing, setEditing] = useState<{ task: Task; captureId: string } | null>(null);
  const toast = useToast();
  useBackLayer(editing !== null, () => setEditing(null));
  /**
   * The note just filed, kept up to date as tags are added here, so it can be
   * offered tags without adding a step to filing - and so Undo knows which
   * note to take away again, as it now is.
   */
  const [justFiled, setJustFiled] = useState<Note | null>(null);
  const filedRef = useRef<Note | null>(null);
  const model = useTagModel();
  const suggestions = useSuggestions(
    model,
    justFiled ? `${justFiled.title}\n${justFiled.body}` : '',
    justFiled?.tags ?? [],
  );

  const all = useLiveQuery(() => db.captures.orderBy('createdAt').reverse().toArray(), [settings.rev], []) ?? [];
  const open = all.filter((c) => !c.clearedAt);
  const cleared = all.filter((c) => c.clearedAt);

  const filed = (note: Note | null) => {
    filedRef.current = note;
    setJustFiled(note);
  };

  const toTask = (capture: Capture) => {
    // First line is the title; anything after it becomes the notes.
    setEditing({ task: blankTask(splitCapture(capture.text)), captureId: capture.id });
  };

  const toNote = async (capture: Capture) => {
    const firstLine = capture.text.split('\n')[0].slice(0, 80);
    // Filing stays a single tap. Tags are offered afterwards, below, so nothing
    // is added to the fastest path through this screen.
    const saved = await saveNote(blankNote({ title: firstLine, body: capture.text }));
    await clearCapture(capture.id);
    filed(saved);
    toast("Kept as a note — it's in Notes.", {
      label: 'Undo',
      run: async () => {
        await unclearCapture(capture.id);
        // The note goes too, so filing it again does not leave two - unless it
        // has been changed since, in which case it is yours and it stays.
        const current = filedRef.current?.id === saved.id ? filedRef.current : saved;
        const removed = await undoFiling(current);
        filed(null);
        toast(
          removed
            ? 'Back in your inbox.'
            : 'Back in your inbox. The note made from it is still in Notes, because it has been changed since.',
        );
      },
    });
  };

  const dismiss = async (capture: Capture) => {
    await clearCapture(capture.id);
    filed(null);
    toast('Moved to "Already dealt with".', {
      label: 'Undo',
      run: async () => {
        await unclearCapture(capture.id);
        toast('Back in your inbox.');
      },
    });
  };

  if (editing) {
    return (
      <TaskEditor
        task={editing.task}
        onSaved={async (saved) => {
          await clearCapture(editing.captureId);
          setEditing(null);
          filed(null);
          toast(savedTaskWhere(saved));
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
                <p className="pre-wrap">{capture.text}</p>
                <p className="faint">Written {shortDateTime(capture.createdAt)}</p>
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

      {/* Tags for the note just filed, offered after the fact so filing stays one tap. */}
      {settings.suggestTags && justFiled && suggestions.length > 0 && (
        <div className="card card-quiet stack-sm">
          <p className="small">Filed "{justFiled.title}" in Notes.</p>
          <TagSuggestions
            suggestions={suggestions}
            onAdd={async (tag) => {
              const note = filedRef.current ?? justFiled;
              filed(await saveNote({ ...note, tags: [...note.tags, tag] }));
            }}
          />
        </div>
      )}

      {cleared.length > 0 && (
        <Section
          title="Already dealt with"
          collapsible="inbox.cleared"
          summary={`${cleared.length} cleared. Nothing is deleted when you clear it.`}
        >
          <div className="stack-sm">
            {cleared.slice(0, 50).map((capture) => (
              <div key={capture.id} className="item">
                <span className="grow muted small pre-wrap">{capture.text}</span>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => void unclearCapture(capture.id)}>
                  Put it back
                </button>
              </div>
            ))}
          </div>
          <p className="faint">Nothing is ever deleted when you clear it. It just moves down here.</p>
        </Section>
      )}
    </>
  );
}
