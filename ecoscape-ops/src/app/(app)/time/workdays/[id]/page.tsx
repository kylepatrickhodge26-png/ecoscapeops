import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ConfirmButton } from "@/components/confirm-button";
import { requireOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDateTime, toLocalInput } from "@/lib/time/format";

import { deleteWorkday, editWorkday } from "../../actions";
import { EditTimeForm } from "../../[id]/edit-form";

export const metadata: Metadata = { title: "Edit workday" };

export default async function EditWorkdayPage(props: PageProps<"/time/workdays/[id]">) {
  const { business } = await requireOwner();
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: shift, error } = await supabase.from("work_shifts").select("id, crew_name, started_at, ended_at, note, auto_closed").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not load the workday: ${error.message}`);
  if (!shift) notFound();

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/time">
            ← Time
          </Link>
          <h1>Edit workday</h1>
          <div className="meta">
            {shift.crew_name} · started {formatDateTime(shift.started_at, business.time_zone)}
          </div>
        </div>
        <div className="head-actions">
          <ConfirmButton
            action={deleteWorkday.bind(null, shift.id)}
            label="Delete"
            confirmLabel="Yes, delete"
            pendingLabel="Deleting…"
            confirmText="Delete this workday? This can't be undone."
          />
        </div>
      </div>
      <div className="panel">
        <div className="panel-body">
          {shift.auto_closed && (
            <p className="notice warn">This day was never ended, so it was closed at their last clock-out. Set the real end time.</p>
          )}
          <EditTimeForm
            action={editWorkday.bind(null, shift.id)}
            initial={{
              started: toLocalInput(shift.started_at, business.time_zone),
              ended: shift.ended_at ? toLocalInput(shift.ended_at, business.time_zone) : "",
              note: "",
            }}
          />
          {shift.note && <p className="hint">Earlier note: {shift.note}</p>}
        </div>
      </div>
    </>
  );
}
