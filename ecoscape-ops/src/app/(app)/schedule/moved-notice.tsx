import { Notice } from "@/components/notice";
import { customerDisplayName } from "@/lib/customers/schema";
import { formatLongDate, isISODate } from "@/lib/dates";
import { movedIds, movedText, weekdayName } from "@/lib/schedule/move";
import { smsLink, toE164 } from "@/lib/sms";

type MovedJob = {
  id: string;
  service_name: string;
  customer: { first_name: string; last_name: string; phone: string; email: string; sms_opt_in: boolean } | null;
};

type Params = Record<string, string | string[] | undefined>;

// After a move: what happened, and a ready-made text for each customer who agreed to texts
// (it opens the phone's Messages app; nothing is sent by the app itself).
export function MovedNotice({ params, jobs, businessName }: { params: Params; jobs: MovedJob[]; businessName: string }) {
  if (params.notice !== "moved" || !isISODate(params.to)) return null;
  const to = params.to;
  const n = Math.max(1, Number(params.n) || 1);
  const later = params.later === "1";
  const ids = movedIds(params.ids);
  const textable = jobs
    .filter((j) => ids.includes(j.id) && j.customer?.sms_opt_in)
    .map((j) => ({ job: j, phone: toE164(j.customer!.phone) }))
    .filter((t): t is { job: MovedJob; phone: string } => t.phone !== null);

  const day = formatLongDate(to);
  const weekday = weekdayName(to);
  const message = later
    ? `Moved to ${day}. Their later visits moved the same number of days (${n} ${n === 1 ? "visit" : "visits"} in all)${
        weekday === "Sunday" ? "." : `, and their regular day is now ${weekday}.`
      }`
    : n === 1
      ? `Moved to ${day}.`
      : `Moved ${n} visits to ${day}.`;

  return (
    <Notice tone="success">
      <span data-testid="moved-notice">{message}</span>
      {textable.length > 0 && (
        <span className="moved-texts">
          {" "}
          Let them know:{" "}
          {textable.map(({ job, phone }) => (
            <a
              key={job.id}
              className="btn secondary small"
              href={smsLink(
                phone,
                movedText({ firstName: job.customer!.first_name, businessName, service: job.service_name, date: to }),
              )}
            >
              Text {customerDisplayName(job.customer!)}
            </a>
          ))}
        </span>
      )}
    </Notice>
  );
}
