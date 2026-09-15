import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { blankNote, db, saveNote } from '../db';
import type { Note, Settings } from '../types';
import { ConfirmButton, Empty, Section, TagList, parseTags, useAutoFocus } from '../components/ui';
import TagSuggestions, { useSuggestions, useTagModel } from '../components/TagSuggestions';

/**
 * Notes are for things you need to look up again: the postcode, the reference
 * number, what the nurse actually said. Plain text on purpose - no formatting
 * to fiddle with, nothing to get wrong, and it reads back exactly as typed.
 */
export default function Notes({ settings }: { settings: Settings }) {
  const [editing, setEditing] = useState<Note | null>(null);
  const [tidying, setTidying] = useState(false);
  const [query, setQuery] = useState('');

  const notes = useLiveQuery(() => db.notes.orderBy('updatedAt').reverse().toArray(), [settings.rev], []) ?? [];

  if (tidying) {
    return <TidyUp notes={notes} onDone={() => setTidying(false)} />;
  }

  if (editing) {
    return (
      <NoteEditor
        note={editing}
        suggestOn={settings.suggestTags}
        onSaved={() => setEditing(null)}
        onCancel={() => setEditing(null)}
        onDelete={async (n) => {
          await db.notes.delete(n.id);
          setEditing(null);
        }}
      />
    );
  }

  const needle = query.trim().toLowerCase();
  const visible = notes.filter(
    (n) =>
      !needle ||
      n.title.toLowerCase().includes(needle) ||
      n.body.toLowerCase().includes(needle) ||
      n.tags.some((t) => t.includes(needle)),
  );
  const pinned = visible.filter((n) => n.pinned);
  const rest = visible.filter((n) => !n.pinned);

  return (
    <>
      <Section
        title="Notes"
        aside={
          <button type="button" className="btn btn-sm" onClick={() => setEditing(blankNote())}>
            New note
          </button>
        }
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search everything in your notes"
          aria-label="Search notes"
        />
        {/* Always here, whether or not anything is untagged. A button that comes
            and going depending on state is one more thing to keep track of. */}
        {settings.suggestTags && (
          <button type="button" className="btn btn-sm" onClick={() => setTidying(true)}>
            Tidy up untagged notes
          </button>
        )}
      </Section>

      {visible.length === 0 && (
        <Empty>
          {needle
            ? `Nothing matches "${query}".`
            : 'Notes live here: reference numbers, phone scripts, what someone told you, anything you will want to look up rather than do.'}
        </Empty>
      )}

      {pinned.length > 0 && (
        <Section title="Kept at the top">
          <div className="stack-sm">
            {pinned.map((note) => (
              <NoteCard key={note.id} note={note} onEdit={setEditing} />
            ))}
          </div>
        </Section>
      )}

      {rest.length > 0 && (
        <div className="stack-sm">
          {pinned.length > 0 && <h3 className="muted">Everything else</h3>}
          {rest.map((note) => (
            <NoteCard key={note.id} note={note} onEdit={setEditing} />
          ))}
        </div>
      )}
    </>
  );
}

function NoteCard({ note, onEdit }: { note: Note; onEdit: (note: Note) => void }) {
  const [open, setOpen] = useState(false);
  const preview = note.body.trim().split('\n').slice(0, 2).join('\n');
  const hasMore = note.body.trim().split('\n').length > 2 || note.body.length > 180;

  return (
    <div className="card card-tight stack-sm">
      <div className="spread">
        <h3 className="grow">{note.title || 'Untitled note'}</h3>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          aria-pressed={note.pinned}
          onClick={() => void saveNote({ ...note, pinned: !note.pinned })}
        >
          {note.pinned ? 'Unpin' : 'Pin'}
        </button>
      </div>
      {note.body.trim() && <p className="note-body">{open ? note.body : preview}</p>}
      <TagList tags={note.tags} />
      <div className="row-tight">
        {hasMore && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen((v) => !v)}>
            {open ? 'Show less' : 'Show all'}
          </button>
        )}
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => onEdit(note)}>
          Edit
        </button>
        <span className="faint">
          Updated {new Date(note.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
        </span>
      </div>
    </div>
  );
}

/**
 * Catching up on old untagged notes in one sitting, rather than one at a time.
 *
 * Deliberately no counter, no progress bar and no "N left to do". This is a
 * thing you can do some of, or none of, and stopping half way is not failing at
 * anything.
 */
function TidyUp({ notes, onDone }: { notes: Note[]; onDone: () => void }) {
  const model = useTagModel();
  const untagged = notes.filter((n) => n.tags.length === 0);

  return (
    <>
      <Section
        title="Tidy up"
        aside={
          <button type="button" className="btn btn-sm" onClick={onDone}>
            Done
          </button>
        }
      >
        {untagged.length === 0 ? (
          <Empty>Every note has a tag. Nothing to do here.</Empty>
        ) : (
          <p className="faint">
            Notes with no tags yet. Add any that look right, skip the rest, and leave whenever you like.
          </p>
        )}
      </Section>

      <div className="stack-sm">
        {untagged.map((note) => (
          <TidyUpRow key={note.id} note={note} model={model} />
        ))}
      </div>
    </>
  );
}

function TidyUpRow({ note, model }: { note: Note; model: ReturnType<typeof useTagModel> }) {
  const suggestions = useSuggestions(model, `${note.title}\n${note.body}`, note.tags);
  const snippet = note.body.trim().split('\n')[0].slice(0, 100);

  return (
    <div className="card card-tight stack-sm">
      <h3>{note.title || 'Untitled note'}</h3>
      {snippet && <p className="note-body">{snippet}</p>}
      <TagList tags={note.tags} />
      {suggestions.length > 0 ? (
        <TagSuggestions
          suggestions={suggestions}
          onAdd={(tag) => void saveNote({ ...note, tags: [...note.tags, tag] })}
        />
      ) : (
        <p className="faint">No suggestion for this one - it needs a tag you have used before.</p>
      )}
    </div>
  );
}

function NoteEditor({
  note,
  suggestOn,
  onSaved,
  onCancel,
  onDelete,
}: {
  note: Note;
  suggestOn: boolean;
  onSaved: () => void;
  onCancel: () => void;
  onDelete: (note: Note) => void;
}) {
  const [draft, setDraft] = useState(note);
  const [tagText, setTagText] = useState(note.tags.join(', '));
  const titleRef = useAutoFocus<HTMLInputElement>();

  const model = useTagModel();
  const suggestions = useSuggestions(model, `${draft.title}\n${draft.body}`, parseTags(tagText));

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        await saveNote({ ...draft, tags: parseTags(tagText) });
        onSaved();
      }}
    >
      <div className="field">
        <label htmlFor="note-title">Title</label>
        <input
          id="note-title"
          ref={titleRef}
          type="text"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          placeholder="What is this about?"
        />
      </div>
      <div className="field">
        <label htmlFor="note-body">The note</label>
        <textarea
          id="note-body"
          value={draft.body}
          onChange={(e) => setDraft({ ...draft, body: e.target.value })}
          rows={12}
          placeholder="Type as much or as little as you like. It saves exactly as written."
        />
      </div>
      <div className="field">
        <label htmlFor="note-tags">Tags, separated by commas</label>
        <input
          id="note-tags"
          type="text"
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          placeholder="medical, house, passwords"
        />
        {suggestOn && (
          <TagSuggestions
            suggestions={suggestions}
            onAdd={(tag) => setTagText(parseTags(`${tagText},${tag}`).join(', '))}
          />
        )}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.pinned}
          onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })}
        />
        <span>Keep this one at the top of the list</span>
      </label>

      <div className="spread">
        <div className="btn-row">
          <button type="submit" className="btn btn-primary">
            Save
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <ConfirmButton
          label="Delete"
          confirmLabel="Yes, delete it"
          className="btn btn-quiet btn-sm"
          onConfirm={() => onDelete(draft)}
        />
      </div>
    </form>
  );
}
