import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { StatusPill } from "@/components/job-status";
import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { customerDisplayName } from "@/lib/customers/schema";
import { formatShortDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { formatPhone, smsLink } from "@/lib/weather/texts";

import { markWeatherTextOpened } from "../../actions";
import { TextActions } from "./text-actions";

export const metadata: Metadata = { title: "Rain delay · EcoScape Ops" };

const REASONS: Record<string, string> = {
  not_opted_in: "Not opted in to texts",
  no_mobile_number: "No usable mobile number",
};

export default async function RainDelayPage(props: PageProps<"/weather/delays/[id]">) {
  const { business } = await requireOwner();
  const { id } = await props.params;
  const { notice } = await props.searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: delay, error } = await supabase
    .from("rain_delays")
    .select("id, from_date, to_date")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load this rain delay: ${error.message}`);
  if (!delay) notFound();

  const [{ data: visits, error: visitsError }, { data: texts, error: textsError }] = await Promise.all([
    supabase
      .from("rain_delay_visits")
      .select(
        "job:jobs(id, scheduled_date, status, service_name, customer:customers(first_name, last_name, phone, email), assignee:crew_members(name))",
      )
      .eq("rain_delay_id", id),
    supabase.rpc("rain_delay_texts", { rain_delay_id: id }),
  ]);
  if (visitsError) throw new Error(`Could not load the moved visits: ${visitsError.message}`);
  if (textsError) throw new Error(`Could not load the texts: ${textsError.message}`);

  const nameOf = (job: { customer: Parameters<typeof customerDisplayName>[0] | null }) =>
    job.customer ? customerDisplayName(job.customer) : "";
  const jobs = visits.flatMap((v) => (v.job ? [v.job] : [])).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const textable = texts.filter((t) => t.can_text);
  const opened = textable.filter((t) => t.opened_at !== null).length;
  const time = new Intl.DateTimeFormat("en-US", { timeZone: business.time_zone, hour: "numeric", minute: "2-digit" });

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/weather">
            ← Weather
          </Link>
          <h1>
            Rain delay: {formatShortDate(delay.from_date)} → {formatShortDate(delay.to_date)}
          </h1>
          <div className="meta">
            {jobs.length} {jobs.length === 1 ? "visit" : "visits"} moved · {texts.length}{" "}
            {texts.length === 1 ? "customer" : "customers"} affected · {textable.length} opted in to texts
          </div>
        </div>
      </div>

      {notice === "moved" && (
        <Notice tone="success">
          Moved {jobs.length} {jobs.length === 1 ? "visit" : "visits"} to {formatShortDate(delay.to_date)}. They&apos;re
          marked Weather delay on the schedule.
        </Notice>
      )}

      <div className="panel">
        <div className="panel-head">
          <h3>Text customers</h3>
          {textable.length > 0 && (
            <span className="subtext" data-testid="texts-opened">
              {opened} of {textable.length} opened
            </span>
          )}
        </div>
        <div className="panel-body">
          {textable.length === 0 ? (
            <p className="hint">None of these customers have opted in to texts.</p>
          ) : (
            <p className="hint">
              Tap <b>Open text</b> to open each customer&apos;s message in your phone&apos;s Messages app, then send it.
              Only customers who have opted in to texts get a message. On a computer, use <b>Copy message</b>, or open
              this page on your phone. If someone replies STOP, turn off their text opt-in.
            </p>
          )}

          <ul className="text-list">
            {texts.map((t) => {
              const name = customerDisplayName({ ...t, email: "" });
              return (
                <li key={t.customer_id} className="text-row" data-customer={name}>
                  <div className="text-who">
                    <Link href={`/customers/${t.customer_id}`}>
                      <b>{name}</b>
                    </Link>
                    <div className="subtext">{t.to_phone ? formatPhone(t.to_phone) : t.phone || "No phone"}</div>
                  </div>
                  <div className="text-what">
                    {!t.can_text ? (
                      <>
                        <span className="pill text-none" data-text-status="wont-text">
                          Won&apos;t be texted
                        </span>
                        <div className="subtext">
                          {REASONS[t.reason ?? ""] ?? t.reason} ·{" "}
                          <Link href={`/customers/${t.customer_id}/edit`}>Edit customer</Link>
                        </div>
                      </>
                    ) : t.opened_at ? (
                      <span className="pill text-opened" data-text-status="opened">
                        Opened {time.format(new Date(t.opened_at))}
                      </span>
                    ) : (
                      <span className="pill text-pending" data-text-status="not-opened">
                        Not texted yet
                      </span>
                    )}
                    {t.body && t.to_phone && (
                      <>
                        <blockquote className="text-body">{t.body}</blockquote>
                        <TextActions
                          href={smsLink(t.to_phone, t.body)}
                          body={t.body}
                          name={name}
                          markOpened={markWeatherTextOpened.bind(null, delay.id, t.customer_id)}
                        />
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Visits moved</h3>
        </div>
        <div className="panel-body flush">
          {jobs.length === 0 ? (
            <div className="empty">These visits have since been deleted.</div>
          ) : (
            <table className="visit-table">
              <thead>
                <tr>
                  <th>Now on</th>
                  <th>Customer</th>
                  <th>Service</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="nowrap">{formatShortDate(job.scheduled_date)}</td>
                    <td>
                      <Link className="row-link" href={`/schedule/jobs/${job.id}`}>
                        {nameOf(job) || "—"}
                      </Link>
                      {job.assignee && <div className="subtext">{job.assignee.name}</div>}
                    </td>
                    <td>{job.service_name}</td>
                    <td>
                      <StatusPill status={job.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
