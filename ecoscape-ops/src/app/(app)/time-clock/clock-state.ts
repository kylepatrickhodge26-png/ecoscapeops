import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

export type MyClock = {
  workdayStartedAt: string | null;
  jobId: string | null;
  jobStartedAt: string | null;
  serviceName: string | null;
  customerName: string | null;
};

// The signed-in person's own clock: their workday and the visit they're clocked in to. Asked
// once per page however many buttons show it.
export const getMyClock = cache(async (): Promise<MyClock> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_clock");
  if (error) throw new Error(`Could not load your clock: ${error.message}`);
  const row = data[0];
  return {
    workdayStartedAt: row?.workday_started_at ?? null,
    jobId: row?.job_id ?? null,
    jobStartedAt: row?.job_started_at ?? null,
    serviceName: row?.service_name ?? null,
    customerName: row?.customer_name ?? null,
  };
});
