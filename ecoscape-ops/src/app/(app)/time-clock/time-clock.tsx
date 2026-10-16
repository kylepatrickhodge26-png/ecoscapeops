import { requireMembership } from "@/lib/auth";
import { formatClock } from "@/lib/time/format";
import { createClient } from "@/lib/supabase/server";

import { clockIn, clockOut } from "./actions";
import { ClockButton } from "./clock-button";

// Clock in / out for the signed-in person on one visit. Shows only their own open entry.
export async function TimeClock({ jobId }: { jobId: string }) {
  const { business } = await requireMembership();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_open_time_entry");
  if (error) throw new Error(`Could not load your time: ${error.message}`);
  const open = data[0];
  const here = open?.job_id === jobId;
  return (
    <ClockButton
      clockedInSince={here ? formatClock(open.started_at, business.time_zone) : null}
      otherJob={open && !here ? open.service_name : null}
      clockIn={clockIn.bind(null, jobId)}
      clockOut={clockOut.bind(null, jobId)}
    />
  );
}
