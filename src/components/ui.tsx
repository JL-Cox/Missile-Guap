import { createContext, Fragment, useCallback, useContext, useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import type { DateKey, Note } from '../types';
import { addDays } from '../lib/time';
import { FOLDS, isOpen as savedOpen, type Fold, type FoldId } from '../lib/sections';
import { pageTitle, zonesOf, type PageId, type ZonedPage, type ZoneOf } from '../lib/zones';

/** Small shared pieces. Everything is labelled in words - no icon-only controls. */

type FixedSection = {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  collapsible?: undefined;
  summary?: never;
  forceOpen?: never;
};

type FoldingSection = {
  title: string;
  children: ReactNode;
  /** Makes the heading a button that folds the section. The value is its stable id. */
  collapsible: FoldId;
  /** One short line shown while it is closed. Plain text only: no amounts when they are blurred. */
  summary?: string;
  /** A view that must reveal something inside (a deep link, an error) sets this. */
  forceOpen?: boolean;
  /** A button inside a button is not allowed, so a header action moves into the body. */
  aside?: never;
};

/**
 * A heading and what is under it. With `collapsible`, the heading becomes the
 * button that folds it: see Folding below and src/lib/sections.ts.
 */
export function Section(props: FixedSection | FoldingSection) {
  if (props.collapsible !== undefined) return <Folding {...props} />;
  const { title, aside, children } = props;
  return (
    <section className="stack" aria-label={title}>
      <div className="section-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * How a remembered fold is read and changed. App provides the real one, which
 * reads and saves `settings.sections`; this default is simply how every
 * section starts.
 */
export interface Folds {
  isOpen: (id: FoldId) => boolean;
  setOpen: (id: FoldId, open: boolean) => void;
}

export const FoldContext = createContext<Folds>({ isOpen: (id) => savedOpen(id), setOpen: () => undefined });

/**
 * The heading of a section that folds. The whole row is one button, kept
 * inside the heading so TalkBack still finds it when it moves by headings,
 * and it says "collapsed" or "expanded" by itself. The button's name is the
 * title and, while closed, the one line under it; "Show" and "Hide" are for
 * the eye only, so it is not read out as "Show, collapsed".
 *
 * Shared with Today's low-day folds so the two look and read exactly alike.
 * `controls` is left off only where nothing is drawn under the heading.
 */
export function FoldHeader({
  title,
  summary,
  open,
  onToggle,
  controls,
  level = 2,
  headingRef,
}: {
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  controls?: string;
  level?: 2 | 3;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const Heading = level === 3 ? 'h3' : 'h2';
  return (
    <Heading className="fold-heading" ref={headingRef}>
      <button type="button" className="fold-btn" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
        <span>
          <span className="fold-title">{title}</span>
          {!open && summary && (
            <>
              {' '}
              <span className="fold-summary">{summaryRun(summary)}</span>
            </>
          )}
        </span>
        <span className="fold-state" aria-hidden="true">
          {open ? 'Hide ▾' : 'Show ▸'}
        </span>
      </button>
    </Heading>
  );
}

/**
 * "Calm · text 160% · animation off", broken only after a dot when it has to
 * wrap at large text: never "14" on one line and "days ahead" on the next, and
 * never a line that starts with "·".
 */
function summaryRun(summary: string): ReactNode {
  const parts = summary.split(' · ');
  if (parts.length === 1) return summary;
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && ' '}
      <span className="nowrap">
        {part}
        {i < parts.length - 1 && ' ·'}
      </span>
    </Fragment>
  ));
}

/**
 * A section that folds to its heading and one line, in the same place, so a
 * closed section never moves anything above it or changes the screen's order.
 *
 * Closing hides what is under the heading rather than removing it, so a
 * half-set PIN, a restore waiting for a yes or an open Details row is exactly
 * as it was when the section is opened again.
 */
function Folding({ title, children, collapsible: id, summary, forceOpen = false }: FoldingSection) {
  const folds = useContext(FoldContext);
  const fold: Fold = FOLDS[id];
  // A section that starts the same way on every visit keeps its state here,
  // so it is forgotten when the screen closes.
  const [visitOpen, setVisitOpen] = useState(fold.open);
  // Opened because the screen had to show something inside. Never saved.
  const [forced, setForced] = useState(false);
  // Only a section opened by a tap fades in; a screen that simply starts with
  // it open should not shimmer every time it is shown.
  const [fading, setFading] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const bodyId = `fold-${id.replace(/\./g, '-')}`;

  useEffect(() => {
    if (!forceOpen) return;
    setForced(true);
    if (headingRef.current) bringUnderHeader(headingRef.current);
  }, [forceOpen]);

  const open = (fold.memory === 'remember' ? folds.isOpen(id) : visitOpen) || forced;
  const toggle = () => {
    const next = !open;
    setForced(false);
    setFading(next);
    if (fold.memory === 'remember') folds.setOpen(id, next);
    else setVisitOpen(next);
  };

  return (
    <section className="stack" aria-label={title}>
      <FoldHeader
        title={title}
        summary={summary}
        open={open}
        onToggle={toggle}
        controls={bodyId}
        headingRef={headingRef}
      />
      <div id={bodyId} className={`stack fold-body${fading ? ' fold-fade' : ''}`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/**
 * Scrolls a heading to just under the sticky header, for a section opened by
 * a deep link. scrollIntoView alone would leave it behind the header, and the
 * header's height changes with the text size, so it is measured, not assumed.
 */
function bringUnderHeader(heading: HTMLElement) {
  const header = document.querySelector('.header');
  const clear = header ? header.getBoundingClientRect().bottom : 0;
  // 12px is --space-3: the same breathing room the header keeps above its own text.
  window.scrollTo({ top: window.scrollY + heading.getBoundingClientRect().top - clear - 12 });
}

/**
 * Empty states never say "you have nothing" or show a sad face. They say what
 * this space is for, so an empty screen reads as ready rather than as failure.
 */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/* ---------------------------------------------------------------------------
   Feedback after an action

   Anything that makes a thing move or disappear says where it went, in a toast,
   and - where it can be taken back - offers Undo right there. Views reach the
   toast through this context rather than a prop threaded through every screen.
   -------------------------------------------------------------------------- */

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastState {
  /** Bumped on every call, so the same words twice still restart the timer. */
  id: number;
  message: string;
  action?: ToastAction;
}

export type ShowToast = (message: string, action?: ToastAction) => void;

export const ToastContext = createContext<ShowToast>(() => undefined);

export function useToast(): ShowToast {
  return useContext(ToastContext);
}

/**
 * How long a toast stays. Longer with an Undo on it, because reading "Deleted."
 * and deciding you did not mean it takes longer than reading "Saved." - and the
 * timer stops altogether while a finger or the keyboard is on the toast.
 */
export const TOAST_MS = 5000;
export const TOAST_WITH_ACTION_MS = 10000;

export function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(onDismiss, toast.action ? TOAST_WITH_ACTION_MS : TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.action, held, onDismiss]);

  return (
    <div
      className="toast"
      role="status"
      aria-live="polite"
      onPointerEnter={() => setHeld(true)}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div className="spread">
        <span className="grow">{toast.message}</span>
        <span className="toast-actions">
          {toast.action && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                // Dismissed first: the action often shows a toast of its own.
                const { run } = toast.action!;
                onDismiss();
                void run();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="btn btn-quiet btn-sm" onClick={onDismiss}>
            Dismiss
          </button>
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   The Back button

   On Android, Back used to leave the app from anywhere, because nothing in it
   ever made a history entry. A view with something open on top of it - an
   editor, a confirmation - declares it here, and App turns that into a history
   entry, so Back closes the editor rather than the app. It also takes the
   zone bar away while it is open: the whole page is the form then, and
   Save, Cancel or Back brings the bar back on the same zone. See App.tsx.
   -------------------------------------------------------------------------- */

export const LayerContext = createContext<(close: (() => void) | null) => void>(() => undefined);

/** While `open`, the Back button calls `close` instead of leaving the screen. */
export function useBackLayer(open: boolean, close: () => void): void {
  const register = useContext(LayerContext);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    register(() => closeRef.current());
    return () => register(null);
  }, [open, register]);
}

/* ---------------------------------------------------------------------------
   Moving between pages from inside one
   -------------------------------------------------------------------------- */

export interface NavigateOptions<P extends PageId> {
  /** The zone to land on, where it matters: "See this paycheck on Money" lands on Paychecks. */
  zone?: P extends ZonedPage ? ZoneOf<P> : never;
  /** Opens Tasks on its Search zone with this already in the box. */
  query?: string;
  /** Opens Notes with this note in the editor: how a task row gets you to the note it points at. */
  note?: Note;
}

/**
 * Changes page, the way choosing it from the Menu does, and optionally lands
 * on one of its zones. Money and Debt send you to each other, Today to Debt
 * and the Backlog, and Notes to Tasks with a search.
 */
export type Navigate = <P extends PageId>(page: P, options?: NavigateOptions<P>) => void;
export const NavigateContext = createContext<Navigate>(() => undefined);
export function useNavigate(): Navigate {
  return useContext(NavigateContext);
}

/* ---------------------------------------------------------------------------
   Zones

   Each working page is split into a few zones, so no page is one long scroll
   (see src/lib/zones.ts). The bar at the bottom picks one; the page draws
   every zone it has, and the ones not picked are hidden rather than removed,
   so an open Details row or a "Show 2 more" is as you left it when you come
   back - the same reason a folded section is hidden rather than removed.
   -------------------------------------------------------------------------- */

export interface ZoneState {
  page: ZonedPage;
  /** The zone showing now. */
  zone: string;
  /** Shows another of this page's zones from its top. `focusTab` moves focus to its tab in the bar. */
  choose: (zone: string, focusTab?: boolean) => void;
}

export const ZoneContext = createContext<ZoneState | null>(null);

export function useZone(): ZoneState | null {
  return useContext(ZoneContext);
}

/**
 * One zone of a page: a tab panel, named by its tab in the bar. Every zone is
 * always drawn, and the bar's tabs point at them, so `aria-controls` always
 * leads somewhere real. test/zones.test.ts checks each page draws each of its
 * zones exactly once.
 */
export function Zone({ id, children }: { id: string; children: ReactNode }) {
  const at = useZone();
  if (!at) return <div className="zone">{children}</div>;
  return (
    <div
      role="tabpanel"
      id={`zone-${at.page}-${id}`}
      aria-labelledby={`tab-${at.page}-${id}`}
      className="zone"
      hidden={at.zone !== id}
    >
      {children}
    </div>
  );
}

/**
 * The bar at the bottom: this page's zones, as tabs. TalkBack reads one as
 * "Coming out, tab, 1 of 4, selected", which says where you are, how many
 * there are and which one is showing. Labels are words, never icons.
 *
 * The keys are the usual ones for tabs: Left and Right move along and wrap,
 * Home and End go to the ends, and moving shows that zone straight away.
 * Only the zone showing is in the Tab order, so Tab leaves the bar in one go.
 */
export function ZoneBar({
  page,
  zone,
  onChoose,
}: {
  page: ZonedPage;
  zone: string;
  onChoose: (zone: string) => void;
}) {
  const zones = zonesOf(page);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const moveTo = (index: number) => {
    const next = (index + zones.length) % zones.length;
    onChoose(zones[next].id);
    tabs.current[next]?.focus();
  };

  return (
    <div className="nav zones" role="tablist" aria-label={`${pageTitle(page)} zones`}>
      {zones.map((z, i) => {
        const selected = z.id === zone;
        return (
          <button
            key={z.id}
            ref={(el) => {
              tabs.current[i] = el;
            }}
            type="button"
            role="tab"
            className="nav-btn"
            id={`tab-${page}-${z.id}`}
            data-zone={z.id}
            aria-selected={selected}
            aria-controls={`zone-${page}-${z.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChoose(z.id)}
            onKeyDown={(e) => {
              const to =
                e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? zones.length - 1 : null;
              if (to === null) return;
              e.preventDefault();
              moveTo(to);
            }}
          >
            {/* The bold width is reserved on every tab (see .nav-label), so the
                slots never shift when the zone showing changes. */}
            <span className="nav-label" data-label={z.label}>
              {z.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * A form's "that didn't work" message. It sits directly above the Save row,
 * where your eyes already are when you press Save, and is scrolled into view
 * and announced - partway up a long form it was easy to press Save, see
 * nothing happen, and not know why. A notice, not an alarm: no red.
 */
export function FormError({ message }: { message: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (message) ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [message]);
  if (!message) return null;
  return (
    <p ref={ref} className="notice" role="alert">
      {message}
    </p>
  );
}

/**
 * Today / Tomorrow / In a week, as buttons, so the three most common days are
 * one tap rather than a trip through the phone's date picker. Shared by the
 * task and subscription editors so they read the same.
 */
export function DateShortcuts({
  value,
  today,
  onPick,
  label,
  noneLabel,
}: {
  value: DateKey | undefined;
  today: DateKey;
  onPick: (date: DateKey | undefined) => void;
  label: string;
  /** Offer "no day" as a choice too, for fields where that is a real answer. */
  noneLabel?: string;
}) {
  const choices: [string, DateKey][] = [
    ['Today', today],
    ['Tomorrow', addDays(today, 1)],
    ['In a week', addDays(today, 7)],
  ];
  return (
    <div className="btn-row" role="group" aria-label={label}>
      {choices.map(([text, date]) => (
        <button
          key={text}
          type="button"
          aria-pressed={value === date}
          className={`btn btn-sm${value === date ? ' btn-primary' : ''}`}
          onClick={() => onPick(date)}
        >
          {text}
        </button>
      ))}
      {noneLabel && (
        <button
          type="button"
          aria-pressed={!value}
          className={`btn btn-sm${!value ? ' btn-primary' : ''}`}
          onClick={() => onPick(undefined)}
        >
          {noneLabel}
        </button>
      )}
    </div>
  );
}

/**
 * The visible way into a row's details. Tapping the title still works, but a
 * title that opens something is a thing you have to know; this says it.
 */
export function DetailsButton({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls?: string }) {
  return (
    <button
      type="button"
      className="btn btn-quiet btn-sm details-btn"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      {open ? 'Details \u25be' : 'Details \u25b8'}
    </button>
  );
}

/** A stable callback that always calls the latest version of `fn`. */
export function useLatest<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args: A) => ref.current(...args), []);
}

/**
 * Destructive actions ask twice, in place, with the real consequence spelled
 * out. No modal that steals focus and no dialog you can dismiss by accident.
 */
export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className = 'btn btn-sm',
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), 6000);
    return () => window.clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <button type="button" className={className} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="row-tight">
      <button type="button" className="btn btn-sm btn-primary" onClick={() => { setArmed(false); onConfirm(); }}>
        {confirmLabel}
      </button>
      <button type="button" className="btn btn-quiet btn-sm" onClick={() => setArmed(false)}>
        Keep it
      </button>
    </span>
  );
}

/**
 * Amounts can be blurred until tapped, for days when seeing the number is too
 * much. `className` adds a role, such as `amount-key` for a screen's anchor.
 */
export function Amount({ text, blur, className }: { text: string; blur: boolean; className?: string }) {
  const [revealed, setRevealed] = useState(false);
  const classes = `amount${className ? ` ${className}` : ''}`;
  if (!blur || revealed) return <span className={classes}>{text}</span>;
  return (
    <button
      type="button"
      className={`${classes} amount-btn blurred`}
      onClick={() => setRevealed(true)}
      aria-label="Amount hidden. Activate to show."
    >
      {text}
    </button>
  );
}

/** Focuses its child textarea/input on mount - used when opening an editor. */
export function useAutoFocus<T extends HTMLElement>(active = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (active) ref.current?.focus();
  }, [active]);
  return ref;
}

export function TagList({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null;
  return (
    <span className="row-tight">
      {tags.map((t) => (
        <span key={t} className="tag">
          {t}
        </span>
      ))}
    </span>
  );
}

export function parseTags(input: string): string[] {
  return [...new Set(input.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
