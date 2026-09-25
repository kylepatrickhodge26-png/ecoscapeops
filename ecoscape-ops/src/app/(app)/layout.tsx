import { requireMembership } from "@/lib/auth";

import { signOut } from "../(auth)/actions";
import { NavLinks } from "./nav-links";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, business } = await requireMembership();

  return (
    <div id="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="name">EcoScape Ops</div>
          <div className="sub" data-testid="business-name">
            {business.name}
          </div>
        </div>
        <NavLinks />
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
