import { redirect } from "next/navigation";

import { requireMembership } from "@/lib/auth";

// Everyone lands on their dashboard: owners see the business, crew their own jobs.
export default async function Home() {
  await requireMembership();
  redirect("/dashboard");
}
