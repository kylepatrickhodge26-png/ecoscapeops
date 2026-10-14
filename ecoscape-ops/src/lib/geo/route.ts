import { milesBetween, type Point } from "./distance";

// One stop on a route: a visit, and where it is (null if the address isn't located).
export type Stop<T> = { id: string; point: Point | null; item: T };

// The suggested order: nearest stop first from the start, then the nearest to that, and
// so on (a quick "nearest neighbor" route; not a full shortest-route solve). Stops with no
// location go last, in the order given.
export function suggestedOrder<T>(start: Point | null, stops: Stop<T>[]): Stop<T>[] {
  const located = stops.filter((s) => s.point);
  const unlocated = stops.filter((s) => !s.point);
  if (!start) return [...located, ...unlocated];

  const ordered: Stop<T>[] = [];
  let here = start;
  const left = [...located];
  while (left.length > 0) {
    let best = 0;
    for (let i = 1; i < left.length; i++) {
      if (milesBetween(here, left[i].point!) < milesBetween(here, left[best].point!)) best = i;
    }
    const [next] = left.splice(best, 1);
    ordered.push(next);
    here = next.point!;
  }
  return [...ordered, ...unlocated];
}

// The order to show: the one set with the arrows if there is one (visits added to the
// route since then go after it, nearest first from its last stop), otherwise the
// suggested order.
export function routeOrder<T>(start: Point | null, stops: Stop<T>[], manual: string[] | null): Stop<T>[] {
  if (!manual) return suggestedOrder(start, stops);
  const byId = new Map(stops.map((s) => [s.id, s]));
  const kept = manual.map((id) => byId.get(id)).filter((s): s is Stop<T> => s !== undefined);
  const keptIds = new Set(kept.map((s) => s.id));
  const lastPoint = kept.findLast((s) => s.point)?.point ?? start;
  return [...kept, ...suggestedOrder(lastPoint, stops.filter((s) => !keptIds.has(s.id)))];
}

// The order after moving one stop up or down a place (unchanged at either end).
export function moveStop(order: string[], id: string, direction: "up" | "down"): string[] {
  const i = order.indexOf(id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
