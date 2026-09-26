import type { Metadata } from "next";
import Link from "next/link";
import { z } from "zod";

import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { getCrew, showAssignment } from "@/lib/crew";
import { customerDisplayName } from "@/lib/customers/schema";
import { formatShortDate, isISOMonth, monthOf, todayInTimeZone } from "@/lib/dates";
import { FREQUENCY_LABELS, isScheduleFilter } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { ScheduleCalendar } from "./schedule-calendar";
import { ScheduleList } from "./schedule-list";

export const metadata: Metadata = { title: "Schedule · EcoScape Ops" };

export default async function SchedulePage(props: PageProps<"/schedule">) {
  const { business, user } = await requireOwner();
  const params = await props.searchParams;
  const today = todayInTimeZone(business.time_zone);

  const view = params.view === "list" ? "list" : "calendar";
  const month = isISOMonth(params.month) ? params.month : monthOf(today);
  const filter = isScheduleFilter(params.filter) ? params.filter : "upcoming";

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Schedule</h1>
          <div className="meta">Today is {formatShortDate(today)}</div>
        </div>
        <div className="head-actions">
          <nav className="segmented" aria-label="View">
            <Link href={`/schedule?month=${month}`} aria-current={view === "calendar" ? "page" : undefined}>
              Calendar
            </Link>
            <Link href={`/schedule?view=list&filter=${filter}`} aria-current={view === "list" ? "page" : undefined}>
              List
            </Link>
          </nav>
          <Link className="btn" href="/schedule/new">
            + Book a job
          </Link>
        </div>
      </div>

      <BookedNotice planId={params.booked} />

      {view === "calendar" ? (
        <ScheduleCalendar businessId={business.id} month={month} today={today} />
      ) : (
        <ScheduleList
          businessId={business.id}
          filter={filter}
          today={today}
          showCrew={showAssignment(await getCrew(business.id, user.id))}
        />
      )}
    </>
  );
}

// "6 visits booked for John Smith — Mowing, every week, starting Tue, Sep 29."
async function BookedNotice({ planId }: { planId: string | string[] | undefined }) {
  if (!z.uuid().safeParse(planId).success) return null;
  const supabase = await createClient();
  const { data: plan } = await supabase
    .from("service_plans")
    .select("service_name, frequency, start_date, customer:customers(first_name, last_name, phone, email), jobs(count)")
    .eq("id", planId as string)
    .maybeSingle();
  if (!plan) return null;

  const visits = plan.jobs[0]?.count ?? 0;
  return (
    <Notice tone="success">
      {visits} {visits === 1 ? "visit" : "visits"} booked for {customerDisplayName(plan.customer)} — {plan.service_name},{" "}
      {FREQUENCY_LABELS[plan.frequency].toLowerCase()}, starting {formatShortDate(plan.start_date)}.
    </Notice>
  );
}
