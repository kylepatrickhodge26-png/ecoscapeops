"use client";

import { useActionState, useEffect, useState } from "react";

import { formatShortDate } from "@/lib/dates";
import { dayChoices, suggestedDay, weekdayName } from "@/lib/schedule/move";

import { moveVisits, type MoveState } from "./move-actions";

// Today, Tomorrow, the next few days as buttons, or any date.
function DayPicker({ today, exclude, value, onChange }: { today: string; exclude: string | null; value: string; onChange: (date: string) => void }) {
  return (
    <div className="day-picker">
      <div className="day-chips" role="group" aria-label="Pick a day">
        {dayChoices(today, exclude).map((c) => (
          <button key={c.date} type="button" className={`day-chip${c.date === value ? " on" : ""}`} aria-pressed={c.date === value} onClick={() => onChange(c.date)}>
            {c.label}
          </button>
        ))}
      </div>
      <label className="day-other">
        <span>Or pick a date</span>
        <input type="date" name="new_date" value={value} onChange={(e) => onChange(e.target.value)} required />
      </label>
    </div>
  );
}

// "Move" on a visit: pick the day, and optionally move their later visits by the same amount.
export function MoveVisit({
  jobId,
  currentDate,
  today,
  recurring,
  back,
  startOpen = false,
}: {
  jobId: string;
  currentDate: string;
  today: string;
  recurring: boolean;
  back: string;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [date, setDate] = useState(() => suggestedDay(today, currentDate));
  const [later, setLater] = useState(false);
  const [state, formAction, pending] = useActionState<MoveState, FormData>(moveVisits.bind(null, back), {});

  if (!open) {
    return (
      <button type="button" className="btn small" onClick={() => setOpen(true)}>
        Move
      </button>
    );
  }

  const day = weekdayName(date || currentDate);
  return (
    <form action={formAction} className="move-panel" id="move" aria-label="Move to another day">
      <input type="hidden" name="job_ids" value={jobId} />
      <h4>Move to another day</h4>
      <DayPicker today={today} exclude={currentDate} value={date} onChange={setDate} />
      {recurring && (
        <label className="checkbox move-later">
          <input type="checkbox" name="move_later" checked={later} onChange={(e) => setLater(e.target.checked)} />
          <span>
            Also move their later visits by the same number of days
            <span className="hint">
              {day === "Sunday" ? " Their regular day stays the same." : ` Their regular day becomes ${day}.`}
            </span>
          </span>
        </label>
      )}
      {state.error && (
        <p className="field-error" role="alert">
          {state.error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn secondary small" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="btn small" disabled={pending || !date || date === currentDate}>
          {pending ? "Moving…" : `Move to ${date ? formatShortDate(date) : "…"}`}
        </button>
      </div>
    </form>
  );
}

// A day's list: tick visits (checkboxes in the list belong to this form), pick a day, move them.
// Folded to one line until you open it or tick a visit; on a phone a floating button brings
// you back to it from further down the list.
export function MoveSelected({ today, fromDate }: { today: string; fromDate: string }) {
  const [date, setDate] = useState(() => suggestedDay(today, fromDate));
  const [ticked, setTicked] = useState(0);
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<MoveState, FormData>(moveVisits.bind(null, "day"), {});

  useEffect(() => {
    const count = () => {
      const n = document.querySelectorAll('input[form="move-selected"]:checked').length;
      setTicked(n);
      if (n > 0) setOpen(true);
    };
    document.addEventListener("change", count);
    count();
    return () => document.removeEventListener("change", count);
  }, []);

  const label = ticked === 0 ? "Tick visits to move" : `Move ${ticked} ${ticked === 1 ? "visit" : "visits"} to ${date ? formatShortDate(date) : "…"}`;
  return (
    <form action={formAction} id="move-selected" className="move-selected-form" aria-label="Move visits to another day">
      <details className="panel move-selected" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>
          Move visits to another day
          {ticked > 0 && <span className="subtext"> · {ticked} ticked</span>}
        </summary>
        <div className="panel-body">
          <p className="hint">Tick the visits below, pick the day, and tap Move. Each one gets a note saying where it came from.</p>
          <DayPicker today={today} exclude={fromDate} value={date} onChange={setDate} />
          {state.error && (
            <p className="field-error" role="alert">
              {state.error}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" className="btn" disabled={pending || ticked === 0 || !date || date === fromDate}>
              {pending ? "Moving…" : label}
            </button>
          </div>
        </div>
      </details>
      {ticked > 0 && (
        <button
          type="button"
          className="btn move-float"
          onClick={() => document.getElementById("move-selected")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          Move {ticked} {ticked === 1 ? "visit" : "visits"}…
        </button>
      )}
    </form>
  );
}
