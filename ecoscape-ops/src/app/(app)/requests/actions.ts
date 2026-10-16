"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { locatePendingCustomers } from "@/lib/geo/customers";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();

export async function setRequestLink(enabled: boolean): Promise<void> {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_request_link_enabled", { enabled });
  if (error) {
    console.error("Switching the request link failed", error);
    redirect("/requests?notice=failed");
  }
  redirect(`/requests?notice=${enabled ? "on" : "off"}`);
}

export async function regenerateRequestLink(): Promise<{ error?: string }> {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.rpc("regenerate_request_link");
  if (error) {
    console.error("Regenerating the request link failed", error);
    return { error: "We couldn't make a new link. Please try again." };
  }
  redirect("/requests?notice=regenerated");
}

// Makes a customer from a request, then goes on to a quote, a booking, or stays here.
export async function convertRequest(requestId: string, formData: FormData): Promise<void> {
  const { business } = await requireOwner();
  if (!uuid.safeParse(requestId).success) redirect("/requests?notice=gone");
  const next = String(formData.get("next") ?? "customer");

  const supabase = await createClient();
  const { data: customerId, error } = await supabase.rpc("convert_request", { request_id: requestId });
  if (error || !customerId) {
    if (error?.code === "P0002") redirect("/requests?notice=gone");
    console.error("Converting request failed", error);
    redirect("/requests?notice=failed");
  }

  // Look the new customer's address up for routes now (never blocks).
  try {
    await locatePendingCustomers(business.id, { customerIds: [customerId], budgetMs: 9_000 });
  } catch (e) {
    console.error("Looking up the customer's address failed", e);
  }

  if (next === "quote") redirect(`/quotes/new?customer=${customerId}`);
  if (next === "book") redirect(`/schedule/new?customer=${customerId}`);
  redirect(`/customers/${customerId}?notice=created`);
}

export async function dismissRequest(requestId: string): Promise<void> {
  await requireOwner();
  if (!uuid.safeParse(requestId).success) redirect("/requests?notice=gone");
  const supabase = await createClient();
  const { error } = await supabase.rpc("dismiss_request", { request_id: requestId });
  if (error && error.code !== "P0002") {
    console.error("Dismissing request failed", error);
    redirect("/requests?notice=failed");
  }
  redirect("/requests?notice=dismissed");
}

export async function deleteRequest(requestId: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!uuid.safeParse(requestId).success) return { error: "This request no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_request", { request_id: requestId });
  if (error && error.code !== "P0002") {
    console.error("Deleting request failed", error);
    return { error: "We couldn't delete this request. Please try again." };
  }
  redirect("/requests?notice=deleted");
}
