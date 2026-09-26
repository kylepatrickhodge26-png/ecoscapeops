import { redirect } from "next/navigation";

import { homePathFor, requireMembership } from "@/lib/auth";

// Owners land on their customers; crew members on their own jobs.
export default async function Home() {
  const { role } = await requireMembership();
  redirect(homePathFor(role));
}
