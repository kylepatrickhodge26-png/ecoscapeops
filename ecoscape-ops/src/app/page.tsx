import { redirect } from "next/navigation";

// Customers is the only feature so far, so it doubles as the home page.
export default function Home() {
  redirect("/customers");
}
