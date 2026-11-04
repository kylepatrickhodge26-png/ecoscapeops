import type { Metadata } from "next";
import Link from "next/link";

import { Notice } from "@/components/notice";
import { RainIcon } from "@/components/rain-icon";
import { requireOwner } from "@/lib/auth";
import { formatShortDate, todayInTimeZone } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";
import { RAIN_LIKELY, dayLabel, riskWindow, topRainRisk, type ForecastDay } from "@/lib/weather/forecast";
import { isRainy, rainHoursLabel, rainOn, spanLabel, wetWord } from "@/lib/weather/hourly";
import { getBusinessForecast, getWorkSettings, getWorkdayRain, type WorkdayRain } from "@/lib/weather/queries";

import { AreaForm } from "./area-form";
import { RainSettingsForm } from "./rain-settings-form";
import { AutoRainNotices } from "./rain-notices";

export const metadata: Metadata = { title: "Weather" };

const NOTICES: Record<string, string> = {
  area: "Service area saved.",
  "work-hours": "Work hours saved.",
};

export default async function WeatherPage(props: PageProps<"/weather">) {
  const { business } = await requireOwner();
  const { notice } = await props.searchParams;
  const today = todayInTimeZone(business.time_zone);
  const [forecast, rainDelays, settings, workRain] = await Promise.all([
    getBusinessForecast(),
    recentRainDelays(business.id),
    getWorkSettings(business.id),
    getWorkdayRain(business),
  ]);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Weather</h1>
          {forecast.status !== "no_area" && (
            <div className="meta">
              National Weather Service forecast for {forecast.area.place_name} ({forecast.area.postal_code}) ·{" "}
              <Link href="/weather/area">Change area</Link>
            </div>
          )}
        </div>
        <Link className="btn" href="/weather/move">
          Move a day&apos;s jobs
        </Link>
      </div>

      {typeof notice === "string" && NOTICES[notice] && <Notice tone="success">{NOTICES[notice]}</Notice>}
      <AutoRainNotices businessId={business.id} today={today} />

      {forecast.status === "no_area" ? (
        <>
          <p className="hint">Add your service area to see the chance of rain over the next few days.</p>
          <AreaForm current="" />
        </>
      ) : forecast.status === "ok" ? (
        <Forecast days={forecast.days} today={today} workRain={workRain} />
      ) : (
        <Notice tone="warn">The forecast is unavailable right now. Please try again in a few minutes.</Notice>
      )}

      <section className="panel" id="work-hours" aria-labelledby="work-hours-title">
        <div className="panel-head">
          <h3 id="work-hours-title">Work hours &amp; rain days</h3>
          <span className="subtext" data-testid="rain-auto-status">
            {settings.autoMove ? "Moving repeat visits automatically" : "Moving visits yourself"}
          </span>
        </div>
        <div className="panel-body">
          <RainSettingsForm initial={{ start: settings.work.start, end: settings.work.end, autoMove: settings.autoMove }} />
        </div>
      </section>

      <div className="panel">
        <div className="panel-head">
          <h3>Rain delays</h3>
        </div>
        <div className="panel-body flush">
          {rainDelays.length === 0 ? (
            <div className="empty">
              <div className="big">No rain delays yet</div>
              When you move a day&apos;s jobs for the weather, it shows up here, with a text ready for each customer
              who has opted in.
            </div>
          ) : (
            <table className="rain-delay-table">
              <thead>
                <tr>
                  <th>Moved</th>
                  <th>Visits</th>
                  <th>Texts opened</th>
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
                      {(d.automatic || d.undone) && (
                        <div className="subtext">
                          {d.automatic && `Automatic${d.rainWindow ? ` · rain likely ${d.rainWindow}` : ""}`}
                          {d.automatic && d.undone && " · "}
                          {d.undone && "Undone"}
                        </div>
                      )}
                    </td>
                    <td>{d.visits}</td>
                    <td>{d.textsOpened || "None yet"}</td>
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

function Forecast({ days, today, workRain }: { days: ForecastDay[]; today: string; workRain: WorkdayRain }) {
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
            <WorkHoursRain date={day.date} workRain={workRain} />
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

// "Rain likely 10am–2pm during work" (or "Dry during work hours") on a forecast day.
function WorkHoursRain({ date, workRain }: { date: string; workRain: WorkdayRain }) {
  if (workRain.status !== "ok") return null;
  const day = rainOn(workRain.days, date);
  if (!day) return null;
  if (isRainy(day)) {
    return (
      <div className="sub strong rain-line" data-testid="work-rain">
        <RainIcon size={11} /> {wetWord(day)} likely {rainHoursLabel(day, workRain.work)}, during work
      </div>
    );
  }
  return day.covered ? (
    <div className="sub" data-testid="work-dry">
      Dry during work hours ({spanLabel(workRain.work.start, workRain.work.end)})
    </div>
  ) : null;
}

type RainDelayRow = {
  id: string;
  from_date: string;
  to_date: string;
  visits: number;
  textsOpened: number;
  automatic: boolean;
  rainWindow: string;
  undone: boolean;
};

async function recentRainDelays(businessId: string): Promise<RainDelayRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rain_delays")
    .select("id, from_date, to_date, automatic, rain_window, undone_at, rain_delay_visits(count), weather_texts(count)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(`Could not load rain delays: ${error.message}`);
  return data.map((d) => ({
    id: d.id,
    from_date: d.from_date,
    to_date: d.to_date,
    visits: d.rain_delay_visits[0]?.count ?? 0,
    textsOpened: d.weather_texts[0]?.count ?? 0,
    automatic: d.automatic,
    rainWindow: d.rain_window,
    undone: d.undone_at !== null,
  }));
}
