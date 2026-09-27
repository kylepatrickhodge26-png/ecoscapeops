import Link from "next/link";

export default function RainDelayNotFound() {
  return (
    <div className="panel">
      <div className="empty">
        <div className="big">Rain delay not found</div>
        <p>This rain delay doesn&apos;t exist.</p>
        <Link className="btn secondary small" href="/weather">
          Back to weather
        </Link>
      </div>
    </div>
  );
}
