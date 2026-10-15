// The hidden fields that say which route a form changes, and where to come back to.
export type RouteRef = { date: string; crewMemberId: string | null; returnTo: string };

export function RouteFields({ route }: { route: RouteRef }) {
  return (
    <>
      <input type="hidden" name="date" value={route.date} />
      <input type="hidden" name="crew_member_id" value={route.crewMemberId ?? ""} />
      <input type="hidden" name="return_to" value={route.returnTo} />
    </>
  );
}
