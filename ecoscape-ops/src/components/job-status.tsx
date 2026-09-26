import { JOB_STATUSES, JOB_STATUS_LABELS, type JobStatus } from "@/lib/schedule/constants";

// Every status has its own silhouette as well as its own color, so statuses stay
// distinguishable in grayscale, for color-blind users, and as tiny calendar marks.
export const STATUS_SHAPES: Record<JobStatus, string> = {
  scheduled: "circle",
  assigned: "ring",
  en_route: "arrow",
  in_progress: "half-circle",
  completed: "square",
  unable_to_complete: "triangle",
  weather_delay: "diamond",
  cancelled: "cross",
};

function ShapePath({ status }: { status: JobStatus }) {
  switch (status) {
    case "scheduled":
      return <circle cx="6" cy="6" r="5" fill="currentColor" />;
    case "assigned":
      return <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />;
    case "en_route":
      return <polygon points="1.5,1 11,6 1.5,11" fill="currentColor" />;
    case "in_progress":
      return (
        <>
          <circle cx="6" cy="6" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6 1.75 A4.25 4.25 0 0 0 6 10.25 Z" fill="currentColor" />
        </>
      );
    case "completed":
      return <rect x="1.25" y="1.25" width="9.5" height="9.5" rx="1.5" fill="currentColor" />;
    case "unable_to_complete":
      return <polygon points="6,0.75 11.5,11 0.5,11" fill="currentColor" />;
    case "weather_delay":
      return <polygon points="6,0.25 11.75,6 6,11.75 0.25,6" fill="currentColor" />;
    case "cancelled":
      return (
        <path d="M2.25 2.25 L9.75 9.75 M9.75 2.25 L2.25 9.75" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
      );
  }
}

export function StatusShape({ status, size = 12 }: { status: JobStatus; size?: number }) {
  return (
    <svg
      className={`status-shape status-${status}`}
      data-shape={STATUS_SHAPES[status]}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      <ShapePath status={status} />
    </svg>
  );
}

export function StatusPill({ status }: { status: JobStatus }) {
  return (
    <span className={`status-pill status-${status}`} data-status={status}>
      <StatusShape status={status} />
      {JOB_STATUS_LABELS[status]}
    </span>
  );
}

export function StatusLegend() {
  return (
    <ul className="status-legend" aria-label="Status key">
      {JOB_STATUSES.map((status) => (
        <li key={status}>
          <StatusShape status={status} />
          {JOB_STATUS_LABELS[status]}
        </li>
      ))}
    </ul>
  );
}
