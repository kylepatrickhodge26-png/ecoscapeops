import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ConfirmButton } from "@/components/confirm-button";
import { StatusPill } from "@/components/job-status";
import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { formatShortDate } from "@/lib/dates";
import { customerDisplayName } from "@/lib/customers/schema";
import { createClient } from "@/lib/supabase/server";
import { twilioConfig } from "@/lib/twilio/client";
import { SMS_STATUS_LABELS, SMS_STATUS_TONES, describeSmsError, formatPhone } from "@/lib/twilio/messages";
import { getTextingNumber } from "@/lib/weather/queries";

import { sendRainDelayTexts } from "../../actions";

export const metadata: Metadata = { title: "Rain delay · EcoScape Ops" };

const REASONS: Record<string, string> = {
  not_opted_in: "Not opted in to texts",
  no_mobile_number: "No usable mobile number",
};

export default async function RainDelayPage(props: PageProps<"/weather/delays/[id]">) {
  const { business } = await requireOwner();
  const { id } = await props.params;
  const search = await props.searchParams;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const { data: delay, error } = await supabase
    .from("rain_delays")
    .select("id, from_date, to_date")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not load this rain delay: ${error.message}`);
  if (!delay) notFound();

  const [{ data: visits, error: visitsError }, { data: texts, error: textsError }, textingNumber] = await Promise.all([
    supabase
      .from("rain_delay_visits")
      .select(
        "job:jobs(id, scheduled_date, status, service_name, customer:customers(first_name, last_name, phone, email), assignee:crew_members(name))",
      )
      .eq("rain_delay_id", id),
    supabase.rpc("rain_delay_texts", { rain_delay_id: id }),
    getTextingNumber(business.id),
  ]);
  if (visitsError) throw new Error(`Could not load the moved visits: ${visitsError.message}`);
  if (textsError) throw new Error(`Could not load the texts: ${textsError.message}`);

  const nameOf = (job: { customer: Parameters<typeof customerDisplayName>[0] | null }) =>
    job.customer ? customerDisplayName(job.customer) : "";
  const jobs = visits.flatMap((v) => (v.job ? [v.job] : [])).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  const toSend = texts.filter((t) => t.can_text && (t.message_id === null || t.status === "failed")).length;
  const optedIn = texts.filter((t) => t.can_text || t.message_id !== null).length;
  const twilioReady = twilioConfig() !== null;
  const sent = Number(search.sent ?? 0);
  const failed = Number(search.failed ?? 0);

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
            {texts.length === 1 ? "customer" : "customers"} affected · {optedIn} opted in to texts
          </div>
        </div>
      </div>

      {search.notice === "moved" && (
        <Notice tone="success">
          Moved {jobs.length} {jobs.length === 1 ? "visit" : "visits"} to {formatShortDate(delay.to_date)}. They&apos;re
          marked Weather delay on the schedule.
        </Notice>
      )}
      {search.notice === "sent" && (
        <Notice tone={failed > 0 ? "warn" : "success"}>
          Sent {sent} {sent === 1 ? "text" : "texts"}.
          {failed > 0 && ` ${failed} couldn't be sent — see below.`}
        </Notice>
      )}

      <div className="panel">
        <div className="panel-head">
          <h3>Text customers</h3>
          <Link className="btn secondary small" href={`/weather/delays/${delay.id}`}>
            Refresh status
          </Link>
        </div>
        <div className="panel-body">
          {!textingNumber ? (
            <Notice tone="warn">
              Texting isn&apos;t set up for your business yet: it needs a texting number, which is assigned by whoever
              runs EcoScape Ops.
            </Notice>
          ) : !twilioReady ? (
            <Notice tone="warn">Texting isn&apos;t connected yet (the server has no Twilio credentials).</Notice>
          ) : toSend > 0 ? (
            <div className="send-texts">
              <p>
                Each opted-in customer gets their own text from <b>{formatPhone(textingNumber)}</b>. Customers who
                haven&apos;t opted in are never texted.
              </p>
              <ConfirmButton
                action={sendRainDelayTexts.bind(null, delay.id)}
                label={`Text ${toSend} ${toSend === 1 ? "customer" : "customers"}`}
                confirmText={
                  <>
                    Send {toSend} {toSend === 1 ? "text" : "texts"} now? Texts can&apos;t be unsent.
                  </>
                }
                confirmLabel="Send texts"
                pendingLabel="Sending…"
                danger={false}
              />
            </div>
          ) : (
            <p className="hint">
              {optedIn === 0 ? "None of these customers have opted in to texts." : "Everyone who can be texted has been."}
            </p>
          )}

          <ul className="text-list">
            {texts.map((t) => {
              const name = customerDisplayName({ ...t, email: "" });
              const problem =
                t.status === "failed" || t.status === "undelivered" ? describeSmsError(t.error_code, t.error_message) : null;
              return (
                <li key={t.customer_id} className="text-row" data-customer={name}>
                  <div className="text-who">
                    <Link href={`/customers/${t.customer_id}`}>
                      <b>{name}</b>
                    </Link>
                    <div className="subtext">{t.to_phone ? formatPhone(t.to_phone) : t.phone || "No phone"}</div>
                  </div>
                  <div className="text-what">
                    {t.status ? (
                      <span className={`pill sms-${SMS_STATUS_TONES[t.status]}`} data-sms-status={t.status}>
                        {SMS_STATUS_LABELS[t.status]}
                      </span>
                    ) : t.can_text ? (
                      <span className="pill sms-pending" data-sms-status="not-sent">
                        Not sent yet
                      </span>
                    ) : (
                      <span className="pill sms-none" data-sms-status="wont-text">
                        Won&apos;t be texted
                      </span>
                    )}
                    {problem && <div className="field-error">{problem}</div>}
                    {!t.status && t.reason && (
                      <div className="subtext">
                        {REASONS[t.reason] ?? t.reason} · <Link href={`/customers/${t.customer_id}/edit`}>Edit customer</Link>
                      </div>
                    )}
                    {t.body && <blockquote className="text-body">{t.body}</blockquote>}
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
