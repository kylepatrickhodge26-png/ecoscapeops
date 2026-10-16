import { requireMembership } from "@/lib/auth";
import { getCrew, showAssignment } from "@/lib/crew";
import { createClient } from "@/lib/supabase/server";

import { signOut } from "../(auth)/actions";
import { NavLinks, type NavLink } from "./nav-links";

const HOME: NavLink = { href: "/dashboard", label: "Home" };
const OWNER_LINKS: NavLink[] = [
  HOME,
  { href: "/customers", label: "Customers" },
  { href: "/schedule", label: "Schedule" },
  { href: "/weather", label: "Weather" },
  { href: "/crew", label: "Crew" },
  { href: "/requests", label: "Requests" },
  { href: "/quotes", label: "Quotes" },
  { href: "/invoices", label: "Invoices" },
  { href: "/expenses", label: "Expenses" },
  { href: "/time", label: "Time" },
  { href: "/reports", label: "Reports" },
  { href: "/settings", label: "Settings" },
];
const MY_JOBS: NavLink = { href: "/my-jobs", label: "My jobs" };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, business, role } = await requireMembership();
  // Crew members only ever get their own jobs. Owners get "My jobs" too once jobs can
  // be assigned (more than one person on the crew).
  let newRequests = 0;
  if (role === "owner") {
    const supabase = await createClient();
    const { count } = await supabase.from("requests").select("id", { count: "exact", head: true }).eq("status", "new");
    newRequests = count ?? 0;
  }
  const ownerLinks = OWNER_LINKS.map((l) => (l.href === "/requests" && newRequests > 0 ? { ...l, label: `Requests (${newRequests})` } : l));
  const links =
    role === "owner"
      ? showAssignment(await getCrew(business.id, user.id))
        ? [...ownerLinks, MY_JOBS]
        : ownerLinks
      : [HOME, MY_JOBS];

  return (
    <div id="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="name">EcoScape Ops</div>
          <div className="sub" data-testid="business-name">
            {business.name}
          </div>
        </div>
        <NavLinks links={links} />
        <div className="sidebar-foot">
          <div className="signed-in-as" title={user.email}>
            {user.email}
          </div>
          <form action={signOut}>
            <button type="submit" className="linklike">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main id="main">{children}</main>
    </div>
  );
}
