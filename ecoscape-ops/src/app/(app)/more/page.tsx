import type { Metadata } from "next";

import { requireOwner } from "@/lib/auth";

import { signOut } from "../../(auth)/actions";
import { HubTiles } from "../hub-tiles";

export const metadata: Metadata = { title: "More" };

export default async function MorePage() {
  const { user } = await requireOwner();
  return (
    <>
      <div className="pagehead">
        <div>
          <h1>More</h1>
          <div className="meta">Signed in as {user.email}</div>
        </div>
      </div>
      <HubTiles
        tiles={[
          { href: "/crew", title: "Crew", text: "Add the people who work with you and give them their own login." },
          { href: "/time", title: "Time", text: "Hours on each job, and which work pays best per hour." },
          { href: "/settings", title: "Settings", text: "Shop address, checklists and photo storage." },
        ]}
      />
      <form action={signOut} className="more-signout">
        <button type="submit" className="btn secondary">
          Sign out
        </button>
      </form>
    </>
  );
}
