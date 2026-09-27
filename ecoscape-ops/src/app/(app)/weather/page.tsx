import type { Metadata } from "next";
import Link from "next/link";

import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { formatShortDate, todayInTimeZone } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { formatPhone } from "@/lib/twilio/messages";
import { RAIN_LIKELY, dayLabel, riskWindow, topRainRisk, type ForecastDay } from "@/lib/weather/forecast";
import { getBusinessForecast, getTextingNumber } from "@/lib/weather/queries";

import { AreaForm } from "./area-form";

export const metadata: Metadata = { title: "Weather · EcoScape Ops" };

const NOTICES: Record<string, string> = {
  area: "Service area saved.",
};

export default async function WeatherPage(props: PageProps<"/weather">) {
  const { business } = await requireOwner();
  const { notice } = await props.searchParams;
  const today = todayInTimeZone(business.time_zone);
  const [forecast, textingNumber, rainDelays] = await Promise.all([
    getBusinessForecast(),
    getTextingNumber(business.id),
    recentRainDelays(business.id),
  ]);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Weather</h1>
          {forecast.status !== "no_area" && (
            <div className="meta">
              Forecast for {forecast.area.place_name} ({forecast.area.postal_code}) ·{" "}
              <Link href="/weather/area">Change area</Link>
            </div>
          )}
        </div>
        <Link className="btn" href="/weather/move">
          Move a day&apos;s jobs
        </Link>
      </div>

      {typeof notice === "string" && NOTICES[notice] && <Notice tone="success">{NOTICES[notice]}</Notice>}

      {forecast.status === "no_area" ? (
        <>
          <p className="hint">Add your service area to see the chance of rain over the next few days.</p>
          <AreaForm current="" />
        </>
      ) : forecast.status === "ok" ? (
        <Forecast days={forecast.days} today={today} />
      ) : forecast.status === "not_configured" ? (
        <Notice tone="warn">The weather forecast isn&apos;t connected yet (the server has no OpenWeather API key).</Notice>
      ) : (
        <Notice tone="warn">The forecast is unavailable right now. Please try again in a few minutes.</Notice>
      )}

      <div className="panel">
        <div className="panel-head">
          <h3>Texting customers</h3>
        </div>
        <div className="panel-body" data-testid="texting-number">
          {textingNumber ? (
            <>
              Weather texts come from <b>{formatPhone(textingNumber)}</b>. Only customers who have opted in to texts
              are ever texted, and replying STOP opts them out.
            </>
          ) : (
            <>
              Texting isn&apos;t set up for your business yet: it needs a texting number, which is assigned by whoever
              runs EcoScape Ops. You can still move a day&apos;s jobs.
            </>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Rain delays</h3>
        </div>
        <div className="panel-body flush">
          {rainDelays.length === 0 ? (
            <div className="empty">
              <div className="big">No rain delays yet</div>
              When you move a day&apos;s jobs for the weather, it shows up here.
            </div>
          ) : (
            <table className="rain-delay-table">
              <thead>
                <tr>
                  <th>Moved</th>
                  <th>Visits</th>
                  <th>Texts</th>
                </tr>
              </thead>
              <tbody>
                {rainDelays.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link className="row-link" href={`/weather/delays/${d.id}`}>
                        <b>
                          {formatShortDate(d.from_date)} → {formatShortDate(d.to_date)}
                        </b>
                      </Link>
                    </td>
                    <td>{d.visits}</td>
                    <td>{textsSummary(d.texts)}</td>
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

function Forecast({ days, today }: { days: ForecastDay[]; today: string }) {
  const window = riskWindow(days, today);
  const top = topRainRisk(days, today);
  const later = days.filter((d) => d.date > (window.at(-1)?.date ?? today));
  if (window.length === 0) return <Notice tone="warn">The forecast doesn&apos;t cover the next few days yet.</Notice>;

  return (
    <>
      <div className="grid" aria-label="Next 3 days">
        {window.map((day) => (
          <div
            key={day.date}
            className={`card forecast-day ${day === top && day.rainChance >= RAIN_LIKELY ? "accent-clay rainy" : "accent-sky"}`}
            data-forecast-date={day.date}
          >
            <div className="label">{dayLabel(day.date, today).toUpperCase()}</div>
            <div className="big">{day.rainChance}%</div>
            <div className="sub">chance of rain{day === top && " · highest"}</div>
            {day.summary && <div className="sub">{day.summary}</div>}
            {day.high !== null && day.low !== null && (
              <div className="sub">
                High {day.high}° · Low {day.low}°
              </div>
            )}
            <div className="sub">
              <Link href={`/weather/move?from=${day.date}`}>Move this day&apos;s jobs →</Link>
            </div>
          </div>
        ))}
      </div>
      {later.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>Later</h3>
          </div>
          <div className="panel-body">
            <ul className="category-totals later-days">
              {later.map((day) => (
                <li key={day.date}>
                  <span>{formatShortDate(day.date)}</span>
                  <b>{day.rainChance}% rain</b>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

type RainDelayRow = { id: string; from_date: string; to_date: string; visits: number; texts: string[] };

async function recentRainDelays(businessId: string): Promise<RainDelayRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rain_delays")
    .select("id, from_date, to_date, rain_delay_visits(count), sms_messages(status)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`Could not load rain delays: ${error.message}`);
  return data.map((d) => ({
    id: d.id,
    from_date: d.from_date,
    to_date: d.to_date,
    visits: d.rain_delay_visits[0]?.count ?? 0,
    texts: d.sms_messages.map((m) => m.status),
  }));
}

function textsSummary(statuses: string[]) {
  if (statuses.length === 0) return "Not texted";
  const failed = statuses.filter((s) => s === "failed" || s === "undelivered").length;
  const ok = statuses.length - failed;
  return [ok > 0 && `${ok} sent`, failed > 0 && `${failed} failed`].filter(Boolean).join(" · ");
}
