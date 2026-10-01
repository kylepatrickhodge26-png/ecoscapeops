import "server-only";

import { notFound } from "next/navigation";
import { z } from "zod";

import { addDays } from "@/lib/dates";
import type { InvoiceStatus } from "@/lib/invoices/constants";
import { createClient } from "@/lib/supabase/server";

// Invoice reads. RLS limits them to the owner's own business; another business's invoice
// is simply not found.

export async function listInvoices(businessId: string, status: InvoiceStatus | null) {
  const supabase = await createClient();
  let query = supabase
    .from("invoices")
    .select("id, number, issue_date, due_date, total, amount_paid, display_status, balance, customer:customers(first_name, last_name, phone, email)")
    .eq("business_id", businessId)
    .order("number", { ascending: false })
    .limit(500);
  if (status) query = query.eq("display_status", status);
  const { data, error } = await query;
  if (error) throw new Error(`Could not load invoices: ${error.message}`);
  return data;
}

export async function getInvoiceOr404(id: string) {
  if (!z.uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoices")
    .select(
      "*, display_status, balance, customer:customers(id, first_name, last_name, phone, email, property_address, billing_address, sms_opt_in), invoice_lines(id, job_id, position, description, quantity, unit_price, amount), payments(id, amount, method, received_on, note, created_at), checkout_sessions(id, amount, status, created_at)",
    )
    .eq("id", id)
    .order("position", { referencedTable: "invoice_lines" })
    .order("received_on", { referencedTable: "payments" })
    .maybeSingle();
  if (error) throw new Error(`Could not load invoice: ${error.message}`);
  if (!data) notFound();
  return data;
}

export type BillableVisit = { id: string; scheduled_date: string; service_name: string; price: number; status: string };

// A customer's visits that can go on an invoice: not cancelled and not already on another
// live invoice (visits on invoiceId itself are included, for editing). From about four
// months back to two months ahead, newest first.
export async function billableVisits(customerId: string, today: string, invoiceId?: string): Promise<BillableVisit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("id, scheduled_date, service_name, price, status, invoice_lines(invoice_id, invoice_cancelled)")
    .eq("customer_id", customerId)
    .neq("status", "cancelled")
    .gte("scheduled_date", addDays(today, -120))
    .lte("scheduled_date", addDays(today, 60))
    .order("scheduled_date", { ascending: false })
    .limit(100);
  if (error) throw new Error(`Could not load visits: ${error.message}`);
  return data
    .filter((j) => j.invoice_lines.every((l) => l.invoice_cancelled || l.invoice_id === invoiceId))
    .map((j) => ({ id: j.id, scheduled_date: j.scheduled_date, service_name: j.service_name, price: j.price, status: j.status }));
}

export async function invoiceSettings(businessId: string) {
  const supabase = await createClient();
  const [{ data: settings }, { data: stripe }] = await Promise.all([
    supabase.from("invoice_settings").select("auto_invoice").eq("business_id", businessId).maybeSingle(),
    supabase.from("stripe_accounts").select("charges_enabled, details_submitted").eq("business_id", businessId).maybeSingle(),
  ]);
  return { autoInvoice: settings?.auto_invoice ?? false, stripe };
}
