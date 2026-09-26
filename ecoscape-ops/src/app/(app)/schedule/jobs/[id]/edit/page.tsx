import type { Metadata } from "next";
import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { assigneeOptions, getCrew, showAssignment } from "@/lib/crew";
import { customerDisplayName } from "@/lib/customers/schema";
import { formatShortDate } from "@/lib/dates";

import { updateJob } from "../../../actions";
import { getJobOr404 } from "../../../get-job";
import { JobForm } from "./job-form";

export const metadata: Metadata = { title: "Edit visit · EcoScape Ops" };

export default async function EditJobPage(props: PageProps<"/schedule/jobs/[id]/edit">) {
  const { business, user } = await requireOwner();
  const { id } = await props.params;
  const job = await getJobOr404(id);
  const crew = await getCrew(business.id, user.id);

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href={`/schedule/jobs/${job.id}`}>
            ← {job.service_name} for {customerDisplayName(job.customer)}, {formatShortDate(job.scheduled_date)}
          </Link>
          <h1>Edit visit</h1>
        </div>
      </div>
      <JobForm
        action={updateJob.bind(null, job.id)}
        initialValues={{
          service_name: job.service_name,
          price: job.price.toFixed(2),
          scheduled_date: job.scheduled_date,
          status: job.status,
          notes: job.notes,
          assigned_crew_member_id: job.assigned_crew_member_id ?? "",
        }}
        assignees={showAssignment(crew) ? assigneeOptions(crew, user.id) : undefined}
        cancelHref={`/schedule/jobs/${job.id}`}
      />
    </>
  );
}
