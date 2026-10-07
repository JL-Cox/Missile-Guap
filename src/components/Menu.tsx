import { useEffect, useRef, type KeyboardEvent } from 'react';
import { PAGES, type PageId } from '../lib/zones';
import { useLatest } from './ui';

/**
 * The Menu: every page, in a drawer from the left, opened by the Menu button
 * at the top left. It is a real modal dialog - App makes everything behind it
 * inert while it is open - so TalkBack and a keyboard stay inside it until it
 * closes.
 *
 * It opens only from the button. There is no swipe from the edge, because
 * Android's own Back gesture lives on the screen's edges. Close, a tap on
 * the dimmed page beside it, Escape and Back all close it.
 *
 * The list sits at the bottom of the drawer, in reach of a thumb, with the
 * heading and Close at the top: look at the top, act at the bottom, as the
 * phone's own apps do. The order never changes.
 */
export default function Menu({
  current,
  inboxCount,
  onChoose,
  onClose,
}: {
  current: PageId;
  /** Captures waiting to be sorted, shown on the Inbox item. */
  inboxCount: number;
  onChoose: (page: PageId) => void;
  onClose: () => void;
}) {
  const drawer = useRef<HTMLDivElement>(null);
  const here = useRef<HTMLButtonElement>(null);
  const close = useLatest(onClose);

  // Focus starts on the page you are on, so the first thing TalkBack says is
  // where you are.
  useEffect(() => {
    here.current?.focus();
  }, []);

  // The page behind does not scroll while the drawer is over it.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('menu-open');
    return () => root.classList.remove('menu-open');
  }, []);

  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  /** Tab and Shift+Tab go round inside the drawer rather than out of it. */
  const keepFocusIn = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !drawer.current) return;
    const buttons = [...drawer.current.querySelectorAll<HTMLButtonElement>('button')];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const groups = [...new Set(PAGES.map((p) => p.group))].map((group) => PAGES.filter((p) => p.group === group));

  return (
    <div className="drawer-layer">
      {/* For a finger only: TalkBack users have Close and Back. */}
      <div className="scrim" aria-hidden="true" onClick={close} />
      <div
        ref={drawer}
        className="drawer"
        id="menu"
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-title"
        onKeyDown={keepFocusIn}
      >
        <div className="drawer-head">
          <h2 id="menu-title">Menu</h2>
          <button type="button" className="btn btn-quiet btn-sm" onClick={close}>
            Close
          </button>
        </div>
        {/* Three short lists, split by a hairline: the lists you work in, the
            two money pages, and the app's own pages. No headings - "list,
            5 items" is all TalkBack needs to say. */}
        <nav aria-label="Pages">
          {groups.map((pages) => (
            <ul key={pages[0].id} className="drawer-group">
              {pages.map((p) => {
                const isHere = p.id === current;
                // "Inbox, 3 to sort", as one label: pieced together from the
                // row's parts, Chrome reads a space before the comma.
                const counted = p.id === 'inbox' && inboxCount > 0;
                return (
                  <li key={p.id}>
                    <button
                      ref={isHere ? here : undefined}
                      type="button"
                      className="drawer-item"
                      data-page={p.id}
                      aria-current={isHere ? 'page' : undefined}
                      aria-label={counted ? `${p.title}, ${inboxCount} to sort` : undefined}
                      onClick={() => onChoose(p.id)}
                    >
                      <span className="drawer-glyph" aria-hidden="true">
                        {p.glyph}
                      </span>
                      <span>{p.title}</span>
                      {counted && (
                        <span className="drawer-count" aria-hidden="true">
                          {inboxCount}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ))}
        </nav>
      </div>
    </div>
  );
}
