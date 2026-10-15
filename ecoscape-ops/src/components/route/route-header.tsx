import { clearRouteStart, resetRouteOrder } from "@/app/(app)/routes/actions";

import { RouteFields, type RouteRef } from "./route-fields";
import { RouteStartForm } from "./route-start";

export type RouteStart = { address: string; isShop: boolean } | null;

// Where a route starts and whether its order was set by hand, with ways to change both.
export function RouteHeader({ route, label, start, manual, canOrder }: {
  route: RouteRef;
  label: string;
  start: RouteStart;
  manual: boolean;
  // False when there's no shop (or day start) to order from.
  canOrder: boolean;
}) {
  return (
    <div className="route-header" data-testid="route-header">
      <div>
        {start ? (
          <span data-testid="route-start">
            Starting from <b>{start.address}</b>
            {start.isShop ? " (shop)" : " (this day only)"}
          </span>
        ) : (
          <span className="subtext">No shop address yet, so stops aren&apos;t in route order.</span>
        )}
        <div className="route-sub">
          {manual ? "Order set by hand." : canOrder ? "Suggested order: nearest stop first." : null}{" "}
          Use the arrows to change it.
        </div>
      </div>
      <div className="route-actions">
        {start && !start.isShop && (
          <form action={clearRouteStart}>
            <RouteFields route={route} />
            <button type="submit" className="btn secondary small">
              Start from the shop
            </button>
          </form>
        )}
        {manual && (
          <form action={resetRouteOrder}>
            <RouteFields route={route} />
            <button type="submit" className="btn secondary small">
              Reset to suggested order
            </button>
          </form>
        )}
        {(start || canOrder) && <RouteStartForm route={route} label={label} />}
      </div>
    </div>
  );
}
