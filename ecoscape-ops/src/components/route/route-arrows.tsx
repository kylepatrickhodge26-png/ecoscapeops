import { moveRouteStop } from "@/app/(app)/routes/actions";

import { RouteFields, type RouteRef } from "./route-fields";

// A stop's number, with ▲ / ▼ to move it a place. The form carries the order as shown,
// so the new order is exactly what the person saw, with that one change.
export function RouteArrows({ route, order, jobId, label }: { route: RouteRef; order: string[]; jobId: string; label: string }) {
  const index = order.indexOf(jobId);
  return (
    <form action={moveRouteStop} className="route-arrows">
      <RouteFields route={route} />
      <input type="hidden" name="order" value={order.join(",")} />
      <input type="hidden" name="job_id" value={jobId} />
      <button type="submit" name="direction" value="up" className="btn secondary small" disabled={index === 0} aria-label={`Move ${label} up`}>
        ▲
      </button>
      <span className="route-number" data-testid="stop-number">
        {index + 1}
      </span>
      <button
        type="submit"
        name="direction"
        value="down"
        className="btn secondary small"
        disabled={index === order.length - 1}
        aria-label={`Move ${label} down`}
      >
        ▼
      </button>
    </form>
  );
}
