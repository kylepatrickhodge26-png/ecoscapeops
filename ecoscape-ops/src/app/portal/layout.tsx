import { signOut } from "../(auth)/actions";

// The customer's own area: no menu of business pages, just their account.
export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="portal-shell">
      <header className="portal-head">
        <div className="name">EcoScape Ops</div>
        <form action={signOut}>
          <button type="submit" className="linklike">
            Sign out
          </button>
        </form>
      </header>
      <main className="portal-main">{children}</main>
    </div>
  );
}
