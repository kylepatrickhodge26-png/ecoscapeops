import { NextResponse, type NextRequest } from "next/server";

import { getUser } from "@/lib/auth";
import { toCsv, type CsvValue } from "@/lib/csv";
import { customerDisplayName } from "@/lib/customers/schema";
import { todayInTimeZone } from "@/lib/dates";
import { parseRange } from "@/lib/reports/range";
import { createClient } from "@/lib/supabase/server";

// CSV downloads for the accountant: customers, jobs, invoices and expenses. Owner only, and
// read as the signed-in owner, so row-level security limits it to their own business even if
// this check were wrong. Crew members get a 403, signed-out visitors a 401.
const KINDS = ["customers", "jobs", "invoices", "expenses"] as const;
type Kind = (typeof KINDS)[number];
const PAGE = 1000;
const MAX_ROWS = 50_000;

export async function GET(request: NextRequest, ctx: RouteContext<"/reports/export/[kind]">) {
  const { kind } = await ctx.params;
  if (!(KINDS as readonly string[]).includes(kind)) return new NextResponse("Not found", { status: 404 });

  const user = await getUser();
  if (!user) return new NextResponse("Sign in first", { status: 401 });

  const supabase = await createClient();
  const { data: member, error } = await supabase
    .from("business_members")
    .select("role, business:businesses(id, name, time_zone)")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !member?.business) return new NextResponse("Not found", { status: 404 });
  if (member.role !== "owner") return new NextResponse("Only the business owner can export data", { status: 403 });

  const business = member.business;
  const today = todayInTimeZone(business.time_zone);
  const params = request.nextUrl.searchParams;
  const range = parseRange({ from: params.get("from") ?? undefined, to: params.get("to") ?? undefined }, today);

  let table: { headers: string[]; rows: CsvValue[][] };
  try {
    table = await build(supabase, business.id, kind as Kind, range);
  } catch (e) {
    console.error("CSV export failed", e);
    return new NextResponse("We couldn't make that file. Please try again.", { status: 500 });
  }

  const filename = kind === "customers" ? `customers-${today}.csv` : `${kind}-${range.from}-to-${range.to}.csv`;
  return new NextResponse(toCsv(table.headers, table.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // Private business data: never stored by the browser, a proxy or the app's offline cache.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type Client = Awaited<ReturnType<typeof createClient>>;

// Reads every page of a query (the API returns at most 1000 rows at a time).
async function allRows<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await fetchPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

async function build(supabase: Client, businessId: string, kind: Kind, range: { from: string; to: string }) {
  if (kind === "customers") {
    const rows = await allRows((a, b) =>
      supabase.from("customers").select("*").eq("business_id", businessId).order("created_at").order("id").range(a, b),
    );
    return {
      headers: ["Name", "First name", "Last name", "Phone", "Email", "Property address", "Billing address", "Status", "Customer since", "Preferred day", "Notification preference", "SMS opt-in", "Gate / access instructions", "Service notes"],
      rows: rows.map((c) => [
        customerDisplayName(c), c.first_name, c.last_name, c.phone, c.email, c.property_address, c.billing_address, c.status,
        c.customer_since, c.preferred_day, c.notification_preference, c.sms_opt_in, c.access_instructions, c.service_notes,
      ]),
    };
  }
  if (kind === "jobs") {
    const rows = await allRows((a, b) =>
      supabase
        .from("jobs")
        .select("id, scheduled_date, status, service_name, price, notes, completed_at, customer:customers(first_name, last_name, phone, email, property_address), assignee:crew_members(name)")
        .eq("business_id", businessId)
        .gte("scheduled_date", range.from)
        .lte("scheduled_date", range.to)
        .order("scheduled_date")
        .order("id")
        .range(a, b),
    );
    return {
      headers: ["Date", "Customer", "Address", "Service", "Price", "Status", "Assigned to", "Completed at", "Notes"],
      rows: rows.map((j) => [
        j.scheduled_date, j.customer ? customerDisplayName(j.customer) : "", j.customer?.property_address ?? "", j.service_name, j.price,
        j.status, j.assignee?.name ?? "", j.completed_at, j.notes,
      ]),
    };
  }
  if (kind === "invoices") {
    const rows = await allRows((a, b) =>
      supabase
        .from("invoices")
        .select("id, number, issue_date, due_date, display_status, total, amount_paid, notes, customer:customers(first_name, last_name, phone, email)")
        .eq("business_id", businessId)
        .gte("issue_date", range.from)
        .lte("issue_date", range.to)
        .order("number")
        .range(a, b),
    );
    return {
      headers: ["Invoice", "Customer", "Issued", "Due", "Status", "Total", "Paid", "Balance", "Notes"],
      rows: rows.map((i) => [
        i.number, i.customer ? customerDisplayName(i.customer) : "", i.issue_date, i.due_date, i.display_status, i.total, i.amount_paid,
        i.display_status === "sent" || i.display_status === "overdue" ? Math.round((i.total - i.amount_paid) * 100) / 100 : 0, i.notes,
      ]),
    };
  }
  const rows = await allRows((a, b) =>
    supabase
      .from("expenses")
      .select("id, spent_on, category, amount, vendor, notes")
      .eq("business_id", businessId)
      .gte("spent_on", range.from)
      .lte("spent_on", range.to)
      .order("spent_on")
      .order("id")
      .range(a, b),
  );
  return {
    headers: ["Date", "Category", "Amount", "Vendor", "Notes"],
    rows: rows.map((e) => [e.spent_on, e.category, e.amount, e.vendor, e.notes]),
  };
}
