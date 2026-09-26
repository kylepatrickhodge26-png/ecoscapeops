import Link from "next/link";

import { ConfirmButton } from "@/components/confirm-button";
import { StatusPill } from "@/components/job-status";
import { formatShortDate } from "@/lib/dates";
import { FREQUENCY_LABELS, formatPrice, isClosed, isOverdue, type Job } from "@/lib/schedule/constants";
import { createClient } from "@/lib/supabase/server";

import { stopServicePlan } from "../../schedule/actions";

const PAST_SHOWN = 20;

type Visit = Pick<Job, "id" | "scheduled_date" | "status" | "service_name" | "price" | "service_plan_id">;

// The customer's booked services and visits, shown on their page.
export async function CustomerSchedule({ customerId, customerName, today }: { customerId: string; customerName: string; today: string }) {
  const supabase = await createClient();
  const [plansResult, jobsResult] = await Promise.all([
    supabase
      .from("service_plans")
      .select("id, service_name, price, frequency, active, start_date")
      .eq("customer_id", customerId)
      .order("created_at"),
    supabase
      .from("jobs")
      .select("id, scheduled_date, status, service_name, price, service_plan_id")
      .eq("customer_id", customerId)
      .order("scheduled_date"),
  ]);
  if (plansResult.error) throw new Error(`Could not load services: ${plansResult.error.message}`);
  if (jobsResult.error) throw new Error(`Could not load visits: ${jobsResult.error.message}`);
  const plans = plansResult.data;
  const visits = jobsResult.data;

  const upcoming = visits.filter((v) => v.scheduled_date >= today && !isClosed(v.status));
  const past = visits
    .filter((v) => !upcoming.includes(v))
    .reverse()
    .slice(0, PAST_SHOWN);

  return (
    <>
      <div className="panel">
        <div className="panel-head">
          <h3>Services</h3>
          <Link className="btn small" href={`/schedule/new?customer=${customerId}`}>
            + Book a service
          </Link>
        </div>
        <div className="panel-body">
          {plans.length === 0 ? (
            <div className="empty">No services booked yet.</div>
          ) : (
            <ul className="service-list">
              {plans.map((plan) => {
                const planUpcoming = upcoming.filter((v) => v.service_plan_id === plan.id);
                const removable = planUpcoming.filter((v) => v.status === "scheduled" || v.status === "assigned").length;
                const recurring = plan.frequency !== "one_time";
                return (
                  <li key={plan.id} className="service-row" data-plan-id={plan.id}>
                    <div>
                      <b>{plan.service_name}</b> — {formatPrice(plan.price)}{" "}
                      <span className="subtext">{FREQUENCY_LABELS[plan.frequency].toLowerCase()}</span>
                      <div className="subtext">
                        {recurring && !plan.active
                          ? "Stopped"
                          : planUpcoming[0]
                            ? `Next visit ${formatShortDate(planUpcoming[0].scheduled_date)}`
                            : "No upcoming visits"}
                      </div>
                    </div>
                    {recurring && plan.active && (
                      <ConfirmButton
                        action={stopServicePlan.bind(null, plan.id, customerId)}
                        label="Stop"
                        confirmLabel="Stop service"
                        pendingLabel="Stopping…"
                        confirmText={
                          <>
                            Stop {plan.service_name} for <b>{customerName}</b>? No more visits will be added
                            {removable > 0 &&
                              `, and the ${removable} upcoming ${removable === 1 ? "visit" : "visits"} that haven't started will be removed`}
                            . Past visits stay in the history.
                          </>
                        }
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Upcoming visits</h3>
        </div>
        <div className="panel-body flush">
          <VisitTable visits={upcoming} today={today} empty="No upcoming visits." />
        </div>
      </div>

      {past.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>Past visits</h3>
          </div>
          <div className="panel-body flush">
            <VisitTable visits={past} today={today} empty="" />
          </div>
        </div>
      )}
    </>
  );
}

function VisitTable({ visits, today, empty }: { visits: Visit[]; today: string; empty: string }) {
  if (visits.length === 0) return <div className="empty">{empty}</div>;
  return (
    <table className="visit-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Service</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {visits.map((v) => (
          <tr key={v.id}>
            <td>
              <Link className="row-link nowrap" href={`/schedule/jobs/${v.id}`}>
                {formatShortDate(v.scheduled_date)}
              </Link>
              {isOverdue(v, today) && <span className="date-tag overdue">Overdue</span>}
            </td>
            <td>
              {v.service_name} · {formatPrice(v.price)}
            </td>
            <td>
              <StatusPill status={v.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
