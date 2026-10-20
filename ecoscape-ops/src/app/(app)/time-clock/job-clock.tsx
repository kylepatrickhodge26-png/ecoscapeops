import { requireMembership } from "@/lib/auth";
import { isClosed, type JobStatus } from "@/lib/schedule/constants";
import { formatClock } from "@/lib/time/format";

import { finishJob, startJob } from "./actions";
import { getMyClock } from "./clock-state";
import { JobClockButtons } from "./job-clock-buttons";

// Clock in / out of one visit for the signed-in person (crew: their own visits; the owner:
// any). Nothing for a visit that's finished or cancelled.
// `compact` (a row in a list) shows nothing while you're clocked in somewhere else.
export async function JobClock({ jobId, status, big = false, compact = false }: { jobId: string; status: JobStatus; big?: boolean; compact?: boolean }) {
  if (isClosed(status)) return null;
  const [{ business }, clock] = await Promise.all([requireMembership(), getMyClock()]);
  const here = clock.jobId === jobId;
  if (compact && clock.jobId && !here) return null;
  return (
    <JobClockButtons
      state={here ? "here" : clock.jobId ? "elsewhere" : "ready"}
      since={here ? clock.jobStartedAt : null}
      sinceText={here && clock.jobStartedAt ? formatClock(clock.jobStartedAt, business.time_zone) : null}
      elsewhere={!here ? clock.customerName : null}
      big={big}
      start={startJob.bind(null, jobId)}
      finish={finishJob.bind(null, jobId, true)}
      leave={finishJob.bind(null, jobId, false)}
    />
  );
}
