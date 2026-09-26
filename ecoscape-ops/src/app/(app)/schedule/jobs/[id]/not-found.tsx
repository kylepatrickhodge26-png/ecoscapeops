import Link from "next/link";

export default function JobNotFound() {
  return (
    <div className="panel">
      <div className="empty">
        <div className="big">Visit not found</div>
        <p>This visit doesn&apos;t exist or has been deleted.</p>
        <Link className="btn secondary small" href="/schedule">
          Back to schedule
        </Link>
      </div>
    </div>
  );
}
