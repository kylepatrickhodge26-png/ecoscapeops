import Link from "next/link";

import { requireMembership } from "@/lib/auth";
import { APP_NAME } from "@/lib/brand";
import { getCrew, showAssignment } from "@/lib/crew";
import { crewSections, ownerSections } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";

import { signOut } from "../(auth)/actions";
import { NavLinks, SectionLinks } from "./nav-links";
import { RainCheck } from "./rain-check";
import { SearchBox } from "./search-box";

// The only tabs: everything else is inside a job, a customer or the Menu.
const TAB_KEYS: string[] = ["home", "schedule", "customers"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, business, role } = await requireMembership();
  let sections;
  if (role === "owner") {
    const supabase = await createClient();
    const { count } = await supabase.from("requests").select("id", { count: "exact", head: true }).eq("status", "new");
    // Owners get "My jobs" once jobs can be assigned (more than one person on the crew).
    sections = ownerSections({ newRequests: count ?? 0, hasCrew: showAssignment(await getCrew(business.id, user.id)) });
  } else {
    sections = crewSections();
  }

  return (
    <div id="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="name">{APP_NAME}</div>
          <div className="sub" data-testid="business-name">
            {business.name}
          </div>
        </div>
        {role === "owner" && <SearchBox />}
        {/* Owners get three tabs; money, crew and settings live behind Menu. Crew get no tab bar:
            Today is their whole app, with a link to all their jobs. */}
        {role === "owner" && <NavLinks sections={sections.filter((s) => TAB_KEYS.includes(s.key))} />}
        <div className="sidebar-foot">
          <div className="signed-in-as" title={user.email}>
            {user.email}
          </div>
          <div className="sidebar-actions">
            {role === "owner" && (
              <Link href="/more" className="linklike">
                Menu
              </Link>
            )}
            <Link href="/help" className="linklike">
              Help
            </Link>
            <form action={signOut}>
              <button type="submit" className="linklike">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main id="main">
        <SectionLinks sections={sections} />
        {children}
      </main>
      {/* Moves rainy days' repeat visits when the owner has that turned on. */}
      {role === "owner" && <RainCheck />}
    </div>
  );
}
