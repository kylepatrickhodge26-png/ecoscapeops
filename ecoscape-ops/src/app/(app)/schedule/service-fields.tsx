"use client";

import { AssignToField } from "@/components/assign-to-field";
import type { AssigneeOption } from "@/lib/crew";
import { FREQUENCY_LABELS, VISITS_AHEAD } from "@/lib/schedule/constants";
import { REPEAT_FREQUENCIES, type ServiceField, type ServiceKind } from "@/lib/schedule/service";

// The work to book: a repeat service (like weekly mowing) or a one-time job (like a patio).
// Used by Book a job and by Add customer, which can book their work in the same step.

type Props = {
  kind: ServiceKind;
  onKindChange: (kind: ServiceKind) => void;
  startDate: string;
  onStartDateChange: (date: string) => void;
  // What was typed before (kept after an error).
  defaults: { frequency: string; service_name: string; price: string; assigned_crew_member_id: string };
  errors: Partial<Record<ServiceField, string>>;
  firstInvalid?: string;
  today: string;
  // Only given once the business has more than one crew member.
  assignees?: AssigneeOption[];
  // Add customer: "Not yet" books nothing.
  allowNone?: boolean;
};

export function ServiceFields({
  kind,
  onKindChange,
  startDate,
  onStartDateChange,
  defaults,
  errors,
  firstInvalid,
  today,
  assignees,
  allowNone = false,
}: Props) {
  const field = (name: ServiceField) => ({
    id: name,
    name,
    autoFocus: name === firstInvalid,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });
  const error = (name: ServiceField) =>
    errors[name] ? (
      <div id={`${name}-error`} className="field-error">
        {errors[name]}
      </div>
    ) : null;
  const repeatDefault = (REPEAT_FREQUENCIES as readonly string[]).includes(defaults.frequency) ? defaults.frequency : "weekly";

  const choice = (value: ServiceKind, title: string, example: string) => (
    <label className={`kind-choice${kind === value ? " on" : ""}`}>
      <input type="radio" name="service_kind" value={value} checked={kind === value} onChange={() => onKindChange(value)} />
      <span>
        <b>{title}</b>
        <span className="hint">{example}</span>
      </span>
    </label>
  );

  return (
    <>
      <fieldset className="kind-choices">
        <legend>{allowNone ? "Their work" : "Kind of work"}</legend>
        {choice("repeat", "Repeat service", "like weekly mowing")}
        {choice("one_time", "One-time job", "like a patio or a cleanup")}
        {allowNone && choice("none", "Not yet", "just add them for now")}
      </fieldset>

      {kind !== "none" && (
        <>
          <div className="row2">
            <div className="field">
              <label htmlFor="service_name">Service</label>
              <input
                {...field("service_name")}
                defaultValue={defaults.service_name}
                placeholder={kind === "repeat" ? "Mowing" : "Paver patio"}
                maxLength={100}
              />
              {error("service_name")}
            </div>
            <div className="field">
              <label htmlFor="price">Price ($)</label>
              <input {...field("price")} defaultValue={defaults.price} inputMode="decimal" placeholder={kind === "repeat" ? "65" : "4500"} />
              {error("price")}
            </div>
          </div>
          <div className="row2">
            {kind === "repeat" ? (
              <div className="field">
                <label htmlFor="frequency">How often</label>
                <select {...field("frequency")} defaultValue={repeatDefault}>
                  {REPEAT_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {FREQUENCY_LABELS[f]}
                    </option>
                  ))}
                </select>
                {error("frequency")}
              </div>
            ) : (
              <input type="hidden" name="frequency" value="one_time" />
            )}
            <div className="field">
              <label htmlFor="start_date">{kind === "one_time" ? "Visit date" : "First visit"}</label>
              <input {...field("start_date")} type="date" min={today} value={startDate} onChange={(e) => onStartDateChange(e.target.value)} />
              {error("start_date")}
            </div>
          </div>

          {assignees && (
            <AssignToField
              assignees={assignees}
              defaultValue={defaults.assigned_crew_member_id}
              error={errors.assigned_crew_member_id}
              hint={kind === "one_time" ? undefined : "Every visit of this service goes to them."}
            />
          )}

          <div className="notice">
            {kind === "one_time"
              ? "This books a single visit."
              : `This books the next ${VISITS_AHEAD} visits. As each one is completed or cancelled, the next is added automatically, so there are always ${VISITS_AHEAD} on the schedule until you stop the service.`}
          </div>
        </>
      )}
    </>
  );
}
