import Link from "next/link";
import { Suspense } from "react";

import { RainIcon } from "@/components/rain-icon";
import { addDays } from "@/lib/dates";
import { dayLabel, topRainRisk } from "@/lib/weather/forecast";
import { isRainy, rainHoursLabel, rainOn, wetWord } from "@/lib/weather/hourly";
import { getDailyForecast } from "@/lib/weather/nws";
import { getWorkdayRain, type ServiceArea } from "@/lib/weather/queries";

type Business = { id: string; time_zone: string };

// The dashboard's rain-risk card: the rainiest of today and the next two days, like the
// prototype's WEATHER card, plus when rain is likely during work hours today or tomorrow.
// Owners also get the rain-day action. The forecast streams in separately, so a slow weather
// service never holds up the rest of the dashboard.
export function WeatherCard({
  area,
  business,
  today,
  isOwner,
}: {
  area: ServiceArea | null;
  business: Business;
  today: string;
  isOwner: boolean;
}) {
  if (!area) return <Card big="—" sub={<Link href="/weather">Add your service area</Link>} />;
  return (
    <Suspense fallback={<Card big="—" sub="Checking forecast…" area={area} loading />}>
      <ForecastCard area={area} business={business} today={today} isOwner={isOwner} />
    </Suspense>
  );
}

async function ForecastCard({ area, business, today, isOwner }: { area: ServiceArea; business: Business; today: string; isOwner: boolean }) {
  const [forecast, rain] = await Promise.all([getDailyForecast(area.latitude, area.longitude), getWorkdayRain(business)]);
  const risk = forecast.ok ? topRainRisk(forecast.days, today) : null;

  let sub: string;
  if (!forecast.ok) {
    sub = "Forecast unavailable right now";
  } else if (!risk) {
    sub = "No forecast for the next 3 days";
  } else if (risk.rainChance === 0) {
    sub = "no rain expected in the next 3 days";
  } else {
    sub = `rain chance ${dayLabel(risk.date, today)}`;
  }

  // "Rain likely 10am–2pm tomorrow, during work hours."
  const soon = rain.status === "ok" ? [today, addDays(today, 1)].map((d) => rainOn(rain.days, d)).find(isRainy) : undefined;
  const workRain =
    soon && rain.status === "ok"
      ? `${wetWord(soon)} likely ${rainHoursLabel(soon, rain.work)} ${dayLabel(soon.date, today)}, during work hours`
      : undefined;

  return (
    <Card
      big={risk ? `${risk.rainChance}%` : "—"}
      sub={sub}
      workRain={workRain}
      area={area}
      action={isOwner ? (risk ? `/weather/move?from=${risk.date}` : "/weather/move") : undefined}
    />
  );
}

type CardProps = {
  big: string;
  sub: React.ReactNode;
  workRain?: string;
  area?: ServiceArea;
  action?: string;
  loading?: boolean;
};

function Card({ big, sub, workRain, area, action, loading = false }: CardProps) {
  return (
    <div className="card accent-clay" data-card={loading ? "weather-loading" : "weather"} aria-busy={loading || undefined}>
      <div className="label">WEATHER</div>
      <div className="big">{big}</div>
      <div className="sub">{sub}</div>
      {workRain && (
        <div className="sub strong rain-line" data-testid="work-rain">
          <RainIcon size={11} /> {workRain}
        </div>
      )}
      {area && <div className="sub">{area.place_name} · next 3 days</div>}
      {action && (
        <div className="sub strong">
          <Link href={action}>Move jobs &amp; text customers →</Link>
        </div>
      )}
    </div>
  );
}
