import Link from "next/link";
import { Suspense } from "react";

import { dayLabel, topRainRisk } from "@/lib/weather/forecast";
import { getDailyForecast } from "@/lib/weather/nws";
import type { ServiceArea } from "@/lib/weather/queries";

// The dashboard's rain-risk card: the rainiest of today and the next two days, like the
// prototype's WEATHER card. Owners also get the rain-day action. The forecast streams in
// separately, so a slow weather service never holds up the rest of the dashboard.
export function WeatherCard({ area, today, isOwner }: { area: ServiceArea | null; today: string; isOwner: boolean }) {
  if (!area) return <Card big="—" sub={<Link href="/weather">Add your service area</Link>} />;
  return (
    <Suspense fallback={<Card big="—" sub="Checking forecast…" area={area} loading />}>
      <ForecastCard area={area} today={today} isOwner={isOwner} />
    </Suspense>
  );
}

async function ForecastCard({ area, today, isOwner }: { area: ServiceArea; today: string; isOwner: boolean }) {
  const forecast = await getDailyForecast(area.latitude, area.longitude);
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

  return (
    <Card
      big={risk ? `${risk.rainChance}%` : "—"}
      sub={sub}
      area={area}
      action={isOwner ? (risk ? `/weather/move?from=${risk.date}` : "/weather/move") : undefined}
    />
  );
}

type CardProps = { big: string; sub: React.ReactNode; area?: ServiceArea; action?: string; loading?: boolean };

function Card({ big, sub, area, action, loading = false }: CardProps) {
  return (
    <div className="card accent-clay" data-card={loading ? "weather-loading" : "weather"} aria-busy={loading || undefined}>
      <div className="label">WEATHER</div>
      <div className="big">{big}</div>
      <div className="sub">{sub}</div>
      {area && <div className="sub">{area.place_name} · next 3 days</div>}
      {action && (
        <div className="sub strong">
          <Link href={action}>Move jobs &amp; text customers →</Link>
        </div>
      )}
    </div>
  );
}
