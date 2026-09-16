import { useState } from 'react';
import { newId, saveIncome } from '../db';
import type { Deduction, IncomeSource, PayFrequency, WeekendShift } from '../types';
import { FREQUENCY_LABELS, isIntervalFrequency, WEEKEND_SHIFT_LABELS, weekendShiftOf } from '../lib/pay';
import { ALL_HOLIDAYS, HOLIDAY_LABELS, holidaysOf } from '../lib/holidays';
import { formatMoney, parseMoney, unitemisedMinor } from '../lib/money';
import { describeDate, todayKey } from '../lib/time';
import { ConfirmButton, useAutoFocus } from './ui';

/**
 * Common US paystub lines, offered as quick-add chips so entering a stub is
 * tapping plus typing numbers, rather than typing nine labels by hand.
 */
const COMMON_DEDUCTIONS = [
  'Federal income tax',
  'Social Security',
  'Medicare',
  'State income tax',
  '401(k)',
  'Health insurance',
  'Dental',
  'Vision',
  'HSA',
];

const FREQUENCIES: PayFrequency[] = ['weekly', 'biweekly', 'semimonthly', 'monthly'];

const DAY_CHOICES: { label: string; days: number[] }[] = [
  { label: '15th and last day', days: [15, 31] },
  { label: '1st and 15th', days: [1, 15] },
];

export default function IncomeEditor({
  source,
  onSaved,
  onCancel,
  onDelete,
}: {
  source: IncomeSource;
  onSaved: (source: IncomeSource) => void;
  onCancel: () => void;
  onDelete: (source: IncomeSource) => void;
}) {
  const [draft, setDraft] = useState(source);
  const [grossText, setGrossText] = useState(source.grossMinor ? (source.grossMinor / 100).toFixed(2) : '');
  const [netText, setNetText] = useState(source.netMinor ? (source.netMinor / 100).toFixed(2) : '');
  const [error, setError] = useState('');
  const nameRef = useAutoFocus<HTMLInputElement>();

  const patch = (changes: Partial<IncomeSource>) => setDraft((d) => ({ ...d, ...changes }));

  const setDeduction = (id: string, changes: Partial<Deduction>) =>
    patch({ deductions: draft.deductions.map((d) => (d.id === id ? { ...d, ...changes } : d)) });

  const addDeduction = (label: string) =>
    patch({ deductions: [...draft.deductions, { id: newId(), label, amountMinor: 0 }] });

  // Live preview of the gap, so a missing line is visible while typing rather
  // than a surprise afterwards.
  const preview: IncomeSource = {
    ...draft,
    grossMinor: parseMoney(grossText) ?? 0,
    netMinor: parseMoney(netText) ?? 0,
  };
  const gap = unitemisedMinor(preview);

  return (
    <form
      className="card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        const grossMinor = parseMoney(grossText);
        const netMinor = parseMoney(netText);
        if (grossMinor === null || netMinor === null) {
          setError("One of those amounts isn't a number I can read. Try something like 2500.00.");
          return;
        }
        if (!draft.name.trim()) return;
        onSaved(await saveIncome({ ...draft, name: draft.name.trim(), grossMinor, netMinor }));
      }}
    >
      <div className="field">
        <label htmlFor="income-name">What is it?</label>
        <input
          id="income-name"
          ref={nameRef}
          type="text"
          value={draft.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Main job"
        />
      </div>

      <div className="field">
        <label>How often are you paid?</label>
        <div className="btn-row">
          {FREQUENCIES.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={draft.frequency === f}
              className={`btn btn-sm${draft.frequency === f ? ' btn-primary' : ''}`}
              onClick={() => patch({ frequency: f })}
            >
              {FREQUENCY_LABELS[f]}
            </button>
          ))}
        </div>
        <p className="faint">
          Every 2 weeks is 26 paycheques a year; twice a month is 24. They are not the same, and the difference
          is two whole paycheques.
        </p>
      </div>

      {isIntervalFrequency(draft.frequency) ? (
        <div className="field">
          <label htmlFor="income-first">A recent payday</label>
          <input
            id="income-first"
            type="date"
            value={draft.firstPaid ?? ''}
            onChange={(e) => patch({ firstPaid: e.target.value || undefined })}
          />
          <p className="faint">
            {draft.firstPaid ? `${describeDate(draft.firstPaid)}. ` : ''}
            Every other payday is counted from this one, so it only has to be right once.
          </p>
        </div>
      ) : (
        <div className="field">
          <label>Which days of the month?</label>
          <div className="btn-row">
            {(draft.frequency === 'semimonthly' ? DAY_CHOICES : [{ label: 'Pick a day below', days: [] }]).map(
              (choice) =>
                choice.days.length > 0 && (
                  <button
                    key={choice.label}
                    type="button"
                    aria-pressed={String(draft.daysOfMonth) === String(choice.days)}
                    className={`btn btn-sm${String(draft.daysOfMonth) === String(choice.days) ? ' btn-primary' : ''}`}
                    onClick={() => patch({ daysOfMonth: choice.days })}
                  >
                    {choice.label}
                  </button>
                ),
            )}
          </div>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Days of the month you are paid"
            value={(draft.daysOfMonth ?? []).join(', ')}
            onChange={(e) =>
              patch({
                daysOfMonth: e.target.value
                  .split(',')
                  .map((n) => Number(n.trim()))
                  .filter((n) => Number.isFinite(n) && n >= 1 && n <= 31),
              })
            }
            placeholder="15, 31"
            style={{ marginTop: 8 }}
          />
          <p className="faint">
            Use 31 for the last day - it lands on the 28th in February and the 30th in April automatically.
          </p>
        </div>
      )}

      <div className="field">
        <label>If payday lands on a weekend</label>
        <div className="btn-row">
          {(['friday', 'monday', 'none'] as WeekendShift[]).map((shift) => (
            <button
              key={shift}
              type="button"
              aria-pressed={weekendShiftOf(draft) === shift}
              className={`btn btn-sm${weekendShiftOf(draft) === shift ? ' btn-primary' : ''}`}
              onClick={() => patch({ weekendShift: shift })}
            >
              {WEEKEND_SHIFT_LABELS[shift]}
            </button>
          ))}
        </div>
        <p className="faint">
          A payday on a day the office is shut moves the same way. It keeps stepping until it reaches a working
          day, so a payday on Boxing Day weekend ends up before Christmas rather than on it.
        </p>
      </div>

      {weekendShiftOf(draft) !== 'none' && (
        <div className="field">
          <label>Days this employer is closed</label>
          <div className="stack-sm">
            {ALL_HOLIDAYS.map((id) => {
              const on = holidaysOf(draft).includes(id);
              return (
                <label key={id} className="check">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      patch({
                        holidays: on
                          ? holidaysOf(draft).filter((h) => h !== id)
                          : [...holidaysOf(draft), id],
                      })
                    }
                  />
                  <span>{HOLIDAY_LABELS[id]}</span>
                </label>
              );
            })}
          </div>
          <p className="faint">
            When one of these falls on a weekend, the day off is taken on the nearest weekday - so New Year's Day
            2028 being a Saturday makes Friday 31 December 2027 the day off, and a payday that day moves.
          </p>
        </div>
      )}

      <div className="field-row">
        <div className="field">
          <label htmlFor="income-gross">Gross, each paycheque</label>
          <input
            id="income-gross"
            type="text"
            inputMode="decimal"
            value={grossText}
            onChange={(e) => {
              setGrossText(e.target.value);
              setError('');
            }}
            placeholder="2500.00"
          />
        </div>
        <div className="field">
          <label htmlFor="income-net">Net, what actually lands</label>
          <input
            id="income-net"
            type="text"
            inputMode="decimal"
            value={netText}
            onChange={(e) => {
              setNetText(e.target.value);
              setError('');
            }}
            placeholder="1850.00"
          />
        </div>
      </div>
      <p className="faint">
        Both straight off the stub. Nothing here works out your tax - rates vary and change, and a confident
        wrong number in your budget is worse than no number.
      </p>
      {error && <p className="pill pill-warn">{error}</p>}

      <div className="field">
        <label>What comes out in between</label>
        {draft.deductions.length > 0 && (
          <div className="stack-sm" style={{ marginBottom: 8 }}>
            {draft.deductions.map((d) => (
              <div key={d.id} className="row-tight">
                <input
                  type="text"
                  aria-label="Deduction name"
                  className="grow"
                  value={d.label}
                  onChange={(e) => setDeduction(d.id, { label: e.target.value })}
                  placeholder="Federal income tax"
                />
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Amount for ${d.label || 'this deduction'}`}
                  style={{ maxWidth: 120 }}
                  value={d.amountMinor ? (d.amountMinor / 100).toFixed(2) : ''}
                  onChange={(e) => setDeduction(d.id, { amountMinor: parseMoney(e.target.value) ?? 0 })}
                  placeholder="0.00"
                />
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={() => patch({ deductions: draft.deductions.filter((x) => x.id !== d.id) })}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="btn-row">
          {COMMON_DEDUCTIONS.filter((label) => !draft.deductions.some((d) => d.label === label)).map((label) => (
            <button key={label} type="button" className="btn btn-sm" onClick={() => addDeduction(label)}>
              + {label}
            </button>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => addDeduction('')}>
            + Something else
          </button>
        </div>
        {gap > 0 && (
          <p className="faint">
            {formatMoney(gap, draft.currency)} of the gap between gross and net is not written down yet. That is
            fine - it just shows as "not itemised". Add lines only if you want the breakdown.
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="income-notes">Notes (optional)</label>
        <textarea
          id="income-notes"
          value={draft.notes}
          onChange={(e) => patch({ notes: e.target.value })}
          placeholder="Which account it lands in, when the next review is..."
        />
      </div>

      {draft.endedOn && (
        <div className="card card-quiet spread">
          <span className="small">Marked as ended on {describeDate(draft.endedOn)}.</span>
          <button type="button" className="btn btn-sm" onClick={() => patch({ endedOn: undefined })}>
            It's current again
          </button>
        </div>
      )}

      <div className="spread">
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={!draft.name.trim()}>
            Save
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
        <div className="btn-row">
          {!draft.endedOn && (
            <ConfirmButton
              label="This has ended"
              confirmLabel="Yes, it has ended"
              className="btn btn-quiet btn-sm"
              onConfirm={() => patch({ endedOn: todayKey() })}
            />
          )}
          <ConfirmButton
            label="Delete"
            confirmLabel="Yes, delete it"
            className="btn btn-quiet btn-sm"
            onConfirm={() => onDelete(draft)}
          />
        </div>
      </div>
    </form>
  );
}
