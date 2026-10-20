import Link from "next/link";

import type { CrewMember } from "@/lib/crew";
import { customerDisplayName } from "@/lib/customers/schema";
import { createClient } from "@/lib/supabase/server";
import { FORGOTTEN_AFTER_HOURS, formatClock, hoursAgo } from "@/lib/time/format";

import { LiveTimer } from "../time-clock/live-timer";

// For the owner: who's on the clock right now, and which visit they're at. Clocks left running
// more than 16 hours count as forgotten and aren't shown.
export async function CrewNow({ businessId, crew, ownerUserId, timeZone }: { businessId: string; crew: CrewMember[]; ownerUserId: string; timeZone: string }) {
  const supabase = await createClient();
  const recent = hoursAgo(FORGOTTEN_AFTER_HOURS);
  const [shifts, entries] = await Promise.all([
    supabase.from("work_shifts").select("crew_member_id, started_at").eq("business_id", businessId).is("ended_at", null).gte("started_at", recent),
    supabase
      .from("time_entries")
      .select("crew_member_id, started_at, job:jobs(id, service_name, customer:customers(first_name, last_name, phone, email))")
      .eq("business_id", businessId)
      .is("ended_at", null)
      .gte("started_at", recent),
  ]);
  if (shifts.error || entries.error) throw new Error(`Could not load who's working: ${(shifts.error ?? entries.error)!.message}`);

  const people = crew.filter((c) => c.user_id);
  const working = shifts.data.length;

  return (
    <section className="panel" aria-label="Crew right now" data-testid="crew-now">
      <div className="panel-head">
        <h3>Crew right now</h3>
        <span className="subtext">
          {working} of {people.length} on the clock
        </span>
      </div>
      <ul className="crew-now">
        {people.map((c) => {
          const shift = shifts.data.find((s) => s.crew_member_id === c.id);
          const entry = entries.data.find((e) => e.crew_member_id === c.id);
          return (
            <li key={c.id} data-crew={c.name} className={shift ? "on" : undefined}>
              <span className="crew-now-name">
                <span className={`clock-dot${shift ? "" : " off"}`} aria-hidden="true" />
                <b>{c.user_id === ownerUserId ? `${c.name} (you)` : c.name}</b>
              </span>
              <span className="crew-now-status">
                {shift ? (
                  <>
                    On since {formatClock(shift.started_at, timeZone)} · <LiveTimer since={shift.started_at} />
                  </>
                ) : (
                  <span className="subtext">Not clocked in</span>
                )}
              </span>
              <span className="crew-now-job">
                {entry?.job ? (
                  <Link href={`/schedule/jobs/${entry.job.id}`}>
                    At {entry.job.customer ? customerDisplayName(entry.job.customer) : "a visit"} · {entry.job.service_name} since{" "}
                    {formatClock(entry.started_at, timeZone)}
                  </Link>
                ) : shift ? (
                  <span className="subtext">Between jobs</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
