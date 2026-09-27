import type { AssigneeOption } from "@/lib/crew";

export function AssignToField({
  assignees,
  defaultValue,
  error,
  hint,
}: {
  assignees: AssigneeOption[];
  defaultValue: string;
  error?: string;
  hint?: string;
}) {
  return (
    <div className="field">
      <label htmlFor="assigned_crew_member_id">Assign to</label>
      <select
        id="assigned_crew_member_id"
        name="assigned_crew_member_id"
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "assigned_crew_member_id-error" : hint ? "assigned_crew_member_id-hint" : undefined}
      >
        <option value="">Unassigned</option>
        {assignees.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
      {error ? (
        <div id="assigned_crew_member_id-error" className="field-error">
          {error}
        </div>
      ) : (
        hint && (
          <div id="assigned_crew_member_id-hint" className="hint">
            {hint}
          </div>
        )
      )}
    </div>
  );
}
