"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import { IMPORT_ROLES, IMPORT_ROLE_LABELS, buildImport, isImportRole, type ImportRole } from "@/lib/customers/import";
import { customerDisplayName } from "@/lib/customers/schema";

import { importCustomers, type ImportState } from "../actions";

const EXAMPLE = `Name, Phone, Address, Notes
John Smith, 631-555-0100, 12 Main St Lake Ronkonkoma, Gate code 1234
Karen Lopez, 631-555-0101, 40 Oak Ave Lake Grove, Dog in the yard`;

// Paste a list (or pick a CSV file), check the columns, see who'll be added, add them all.
export function ImportForm() {
  const [state, formAction, pending] = useActionState<ImportState, FormData>(importCustomers, {});
  const [text, setText] = useState("");
  const [fileNote, setFileNote] = useState("");
  // The owner's own choices; until then, what's worked out from the list.
  const [roles, setRoles] = useState<ImportRole[] | null>(null);
  const [hasHeader, setHasHeader] = useState<boolean | null>(null);

  const result = useMemo(
    () => (text.trim() ? buildImport(text, { roles: roles ?? undefined, hasHeader: hasHeader ?? undefined }) : null),
    [text, roles, hasHeader],
  );

  const newList = (value: string) => {
    setText(value);
    setRoles(null);
    setHasHeader(null);
  };

  return (
    <form action={formAction} className="panel panel-body import-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}

      <div className="field">
        <label htmlFor="import-text">Paste your list</label>
        <textarea
          id="import-text"
          name="text"
          rows={8}
          value={text}
          onChange={(e) => newList(e.target.value)}
          placeholder={EXAMPLE}
          spellCheck={false}
        />
        <div className="hint">
          One customer per line. Copy the rows straight from a spreadsheet (Excel, Google Sheets, Numbers), or type them with
          commas between: name, phone, address, email, notes, in any order.
        </div>
      </div>
      <div className="field">
        <label htmlFor="import-file">Or choose a spreadsheet saved as a CSV file</label>
        <input
          id="import-file"
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/plain"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 1_000_000) {
              setFileNote("That file is too big. Save fewer rows (up to 500 customers) and try again.");
              return;
            }
            newList(await file.text());
            setFileNote(`Loaded ${file.name}.`);
          }}
        />
        {fileNote && <div className="hint">{fileNote}</div>}
      </div>

      {result && result.columns > 0 && (
        <>
          <input type="hidden" name="roles" value={JSON.stringify(result.roles)} />
          <input type="hidden" name="has_header" value={result.hasHeader ? "1" : "0"} />

          <h3 className="import-heading">Check the columns</h3>
          <label className="checkbox">
            <input type="checkbox" checked={result.hasHeader} onChange={(e) => setHasHeader(e.target.checked)} /> The first row
            is column names, not a customer
          </label>
          <div className="import-columns">
            {result.roles.map((role, c) => (
              <div className="field" key={c}>
                <label htmlFor={`import-col-${c}`}>Column {c + 1}</label>
                <select
                  id={`import-col-${c}`}
                  value={role}
                  onChange={(e) => {
                    const next = [...result.roles];
                    next[c] = isImportRole(e.target.value) ? e.target.value : "skip";
                    setRoles(next);
                  }}
                >
                  {IMPORT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {IMPORT_ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <h3 className="import-heading">
            {result.rows.length} {result.rows.length === 1 ? "customer" : "customers"} ready to add
          </h3>
          {result.rows.length > 0 && (
            <div className="table-scroll">
              <table className="import-preview">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Email</th>
                    <th>Address</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 10).map((r) => (
                    <tr key={r.line}>
                      <td>
                        <b>{customerDisplayName(r) || "—"}</b>
                        {r.warning && <div className="field-error">{r.warning}</div>}
                      </td>
                      <td className="nowrap">{r.phone || "—"}</td>
                      <td>{r.email || "—"}</td>
                      <td>{r.property_address || "—"}</td>
                      <td>{r.service_notes || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.rows.length > 10 && <p className="hint">…and {result.rows.length - 10} more.</p>}
          {result.skipped.length > 0 && (
            <div className="notice warn">
              {result.skipped.length} {result.skipped.length === 1 ? "row is" : "rows are"} left out:{" "}
              {result.skipped
                .slice(0, 5)
                .map((s) => `line ${s.line} (${s.reason.toLowerCase()})`)
                .join(", ")}
              {result.skipped.length > 5 ? ", …" : "."}
            </div>
          )}
          <p className="hint">
            Anyone already in your customers (same phone number, or same name and address) is left out, so importing the same
            list twice adds no one twice. You can book each customer&apos;s work from their page afterwards.
          </p>
        </>
      )}

      <div className="form-actions">
        <Link className="btn secondary" href="/customers">
          Cancel
        </Link>
        <button className="btn" type="submit" disabled={pending || !result || result.rows.length === 0}>
          {pending
            ? "Adding…"
            : result && result.rows.length > 0
              ? `Add ${result.rows.length} ${result.rows.length === 1 ? "customer" : "customers"}`
              : "Add customers"}
        </button>
      </div>
    </form>
  );
}
