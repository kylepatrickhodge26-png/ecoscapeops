import type { Enums, Tables } from "@/lib/supabase/database.types";

export type Job = Tables<"jobs">;
export type ServicePlan = Tables<"service_plans">;
export type JobStatus = Enums<"job_status">;
export type Frequency = Enums<"service_frequency">;

// The 8 job statuses from the prototype, in lifecycle order. Each has its own shape
// and color (see job-status.tsx) so no two can be told apart by color alone.
export const JOB_STATUSES = [
  "scheduled",
  "assigned",
  "en_route",
  "in_progress",
  "completed",
  "unable_to_complete",
  "weather_delay",
  "cancelled",
] as const satisfies readonly JobStatus[];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  scheduled: "Scheduled",
  assigned: "Assigned",
  en_route: "En route",
  in_progress: "In progress",
  completed: "Completed",
  unable_to_complete: "Unable to complete",
  weather_delay: "Weather delay",
  cancelled: "Cancelled",
};

// Visits that are finished one way or another. Everything else is still "open".
export const CLOSED_STATUSES: readonly JobStatus[] = ["completed", "cancelled"];
export const isClosed = (status: JobStatus) => CLOSED_STATUSES.includes(status);

// Statuses that always need the owner's attention, whatever the date.
export const ATTENTION_STATUSES: readonly JobStatus[] = ["unable_to_complete", "weather_delay"];

export const FREQUENCIES = ["weekly", "biweekly", "triweekly", "one_time"] as const satisfies readonly Frequency[];

export const FREQUENCY_LABELS: Record<Frequency, string> = {
  weekly: "Every week",
  biweekly: "Every 2 weeks",
  triweekly: "Every 3 weeks",
  one_time: "One time",
};

// Matches the database: recurring plans keep this many open visits on the schedule.
export const VISITS_AHEAD = 6;

// A past visit that was never completed or cancelled.
export function isOverdue(job: Pick<Job, "status" | "scheduled_date">, today: string): boolean {
  return job.scheduled_date < today && !isClosed(job.status);
}

export function needsAttention(job: Pick<Job, "status" | "scheduled_date">, today: string): boolean {
  return ATTENTION_STATUSES.includes(job.status) || isOverdue(job, today);
}

export const SCHEDULE_FILTERS = ["upcoming", "today", "completed", "attention", "all"] as const;
export type ScheduleFilter = (typeof SCHEDULE_FILTERS)[number];

export const SCHEDULE_FILTER_LABELS: Record<ScheduleFilter, string> = {
  upcoming: "Upcoming",
  today: "Today",
  completed: "Completed",
  attention: "Needs attention",
  all: "All",
};

// The same rules the list view's database query uses (see schedule/queries.ts).
export function matchesFilter(
  job: Pick<Job, "status" | "scheduled_date">,
  filter: ScheduleFilter,
  today: string,
): boolean {
  switch (filter) {
    case "upcoming":
      return job.scheduled_date >= today && !isClosed(job.status);
    case "today":
      return job.scheduled_date === today;
    case "completed":
      return job.status === "completed";
    case "attention":
      return needsAttention(job, today);
    case "all":
      return true;
  }
}

export function isScheduleFilter(value: unknown): value is ScheduleFilter {
  return typeof value === "string" && (SCHEDULE_FILTERS as readonly string[]).includes(value);
}

export function formatPrice(price: number): string {
  return price.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
