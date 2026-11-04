"use client";

import { useActionState } from "react";

import { EARLIEST_START, LATEST_END, WORK_TIME_CHOICES, choiceLabel, timeValue } from "@/lib/weather/hourly";

import { saveRainSettings, type RainSettingsState, type RainSettingsValues } from "./actions";

// The times on offer, plus the saved one if it's between them (say 8:15).
const choices = (current: number) => [...new Set([...WORK_TIME_CHOICES, current])].sort((a, b) => a - b);

export function RainSettingsForm({ initial }: { initial: RainSettingsValues }) {
  const [state, formAction, pending] = useActionState<RainSettingsState, FormData>(saveRainSettings, { values: initial });
  const { values } = state;

  return (
    // Remount after each submit so the fields show what was submitted (see CustomerForm).
    <form key={JSON.stringify(state)} action={formAction} noValidate className="rain-settings">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div className="row2">
        <div className="field">
          <label htmlFor="work_start">Work starts</label>
          <select id="work_start" name="work_start" defaultValue={timeValue(values.start)}>
            {choices(values.start)
              .filter((m) => m < LATEST_END)
              .map((m) => (
                <option key={m} value={timeValue(m)}>
                  {choiceLabel(m)}
                </option>
              ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="work_end">Work ends</label>
          <select
            id="work_end"
            name="work_end"
            defaultValue={timeValue(values.end)}
            autoFocus={Boolean(state.fieldError)}
            aria-invalid={state.fieldError ? true : undefined}
            aria-describedby={state.fieldError ? "work_end-error" : undefined}
          >
            {choices(values.end)
              .filter((m) => m > EARLIEST_START)
              .map((m) => (
                <option key={m} value={timeValue(m)}>
                  {choiceLabel(m)}
                </option>
              ))}
          </select>
          {state.fieldError && (
            <div id="work_end-error" className="field-error">
              {state.fieldError}
            </div>
          )}
        </div>
      </div>
      <p className="hint">Rain marks on the calendar are for these hours. Rain before or after them doesn&apos;t count.</p>

      <div className="field checkbox">
        <label>
          <input type="checkbox" name="rain_auto_move" defaultChecked={values.autoMove} />
          Move repeat visits automatically when rain is likely during work hours
        </label>
      </div>
      <p className="hint">
        The app checks the evening before (after work) and in the morning before work starts, whenever you open it. If
        there&apos;s a 50% or higher chance of rain during work hours, that day&apos;s weekly and every-few-weeks visits move to
        the next day without rain (never a Sunday) and are marked Weather delay. One-time jobs and visits already started stay
        put. You&apos;ll see a note with a text ready for each customer who gets texts, and you can undo it.
      </p>

      <div className="form-actions">
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save work hours"}
        </button>
      </div>
    </form>
  );
}
