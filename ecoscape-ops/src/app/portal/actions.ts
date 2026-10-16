"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { requireCustomer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const uuid = z.uuid();
const FRIENDLY = new Set(["22023", "P0002", "P0429", "42501"]);

export async function respondToQuote(quoteId: string, accept: boolean): Promise<{ error?: string; done?: boolean }> {
  if (!(await requireCustomer())) return { error: "This login doesn't have a customer account." };
  if (!uuid.safeParse(quoteId).success) return { error: "This quote no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_respond_to_quote", { quote_id: quoteId, accept });
  if (error) {
    if (FRIENDLY.has(error.code)) return { error: `${error.message}.` };
    console.error("Answering quote failed", error);
    return { error: "We couldn't send your answer. Please try again." };
  }
  refresh();
  return { done: true };
}

export type ServiceRequestState = { error?: string; sent?: boolean; details?: string };

export async function requestService(_prev: ServiceRequestState, formData: FormData): Promise<ServiceRequestState> {
  if (!(await requireCustomer())) return { error: "This login doesn't have a customer account." };
  const details = String(formData.get("details") ?? "");
  if (details.trim() === "") return { error: "Tell us what you need.", details };
  if (details.length > 1500) return { error: "Please keep it to 1,500 characters.", details };
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_request_service", { details });
  if (error) {
    if (FRIENDLY.has(error.code)) return { error: `${error.message}.`, details };
    console.error("Requesting service failed", error);
    return { error: "We couldn't send that. Please try again.", details };
  }
  return { sent: true };
}
