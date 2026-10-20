import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ConfirmButton } from "@/components/confirm-button";
import { requireOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { formatShortDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { toLocalInput } from "@/lib/time/format";

import { deleteTimeEntry, editTimeEntry } from "../actions";
import { EditTimeForm } from "./edit-form";

export const metadata: Metadata = { title: "Edit time" };

export default async function EditTimePage(props: PageProps<"/time/[id]">) {
  const { business } = await requireOwner();
  const { id } = await props.params;
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: entry, error } = await supabase
    .from("time_entries")
    .select("id, crew_name, started_at, ended_at, note, job:jobs(id, service_name, scheduled_date, customer:customers(first_name, last_name, phone, email))")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load the time entry: ${error.message}`);
  if (!entry) notFound();

  const customer = entry.job?.customer ? customerDisplayName(entry.job.customer) : "";
  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/time">
            ← Time
          </Link>
          <h1>Edit time</h1>
          <div className="meta">
            {entry.crew_name} · {entry.job?.service_name} for {customer}
            {entry.job && ` · ${formatShortDate(entry.job.scheduled_date)}`}
          </div>
        </div>
        <div className="head-actions">
          <ConfirmButton
            action={deleteTimeEntry.bind(null, entry.id)}
            label="Delete"
            confirmLabel="Yes, delete"
            pendingLabel="Deleting…"
            confirmText="Delete this time entry? This can't be undone."
          />
        </div>
      </div>
      <div className="panel">
        <div className="panel-body">
          <EditTimeForm
            action={editTimeEntry.bind(null, entry.id)}
            initial={{
              started: toLocalInput(entry.started_at, business.time_zone),
              ended: entry.ended_at ? toLocalInput(entry.ended_at, business.time_zone) : "",
              note: "",
            }}
          />
          {entry.note && <p className="hint">Earlier note: {entry.note}</p>}
        </div>
      </div>
    </>
  );
}
