import type { Point } from "@/lib/geo/distance";
import { routeOrder } from "@/lib/geo/route";

// What's saved for one route on one day (a route_days row, or crew_route_settings).
export type RouteDay = {
  start_address: string | null;
  start_lat: number | null;
  start_lon: number | null;
  manual_order: string[] | null;
};

export type ShopPoint = { address: string; lat: number; lon: number };

export type BuiltRoute<T> = {
  start: { address: string; isShop: boolean } | null;
  manual: boolean;
  canOrder: boolean;
  stops: T[];
};

// One route's stops in the order to show: from the day's own start if it has one,
// otherwise from the shop; the hand-set order if there is one, otherwise nearest first.
export function buildRoute<T extends { id: string }>(
  items: T[],
  pointOf: (item: T) => Point | null,
  day: RouteDay | null | undefined,
  shop: ShopPoint | null,
): BuiltRoute<T> {
  const dayStart =
    day?.start_address && day.start_lat != null && day.start_lon != null
      ? { address: day.start_address, isShop: false, point: { lat: day.start_lat, lon: day.start_lon } }
      : null;
  const start = dayStart ?? (shop ? { address: shop.address, isShop: true, point: { lat: shop.lat, lon: shop.lon } } : null);
  const manual = day?.manual_order ?? null;
  const ordered = routeOrder(
    start?.point ?? null,
    items.map((item) => ({ id: item.id, point: pointOf(item), item })),
    manual,
  ).map((s) => s.item);
  return { start: start && { address: start.address, isShop: start.isShop }, manual: manual !== null, canOrder: start !== null, stops: ordered };
}
