import { requireMembership } from "@/lib/auth";
import { getCrew, showAssignment } from "@/lib/crew";

import { signOut } from "../(auth)/actions";
import { NavLinks, type NavLink } from "./nav-links";

const OWNER_LINKS: NavLink[] = [
  { href: "/customers", label: "Customers" },
  { href: "/schedule", label: "Schedule" },
  { href: "/crew", label: "Crew" },
];
const MY_JOBS: NavLink = { href: "/my-jobs", label: "My jobs" };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, business, role } = await requireMembership();
  // Crew members only ever get their own jobs. Owners get "My jobs" too once jobs can
  // be assigned (more than one person on the crew).
  const links =
    role === "owner"
      ? showAssignment(await getCrew(business.id, user.id))
        ? [...OWNER_LINKS, MY_JOBS]
        : OWNER_LINKS
      : [MY_JOBS];

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
