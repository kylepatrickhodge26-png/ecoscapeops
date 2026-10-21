"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireOwner } from "@/lib/auth";
import { parseFaq, type FaqField, type FaqValues } from "@/lib/faq";
import { createClient } from "@/lib/supabase/server";

export type FaqFormState = { values: FaqValues; error?: string; fieldErrors?: Partial<Record<FaqField, string>> };

const itemId = z.uuid();

// Adds a question (id null) or saves changes to one. Row-level security keeps it to the
// owner's own business: another business's question matches nothing.
export async function saveFaqItem(id: string | null, _prev: FaqFormState, formData: FormData): Promise<FaqFormState> {
  const { business } = await requireOwner();
  const values = { question: String(formData.get("question") ?? ""), answer: String(formData.get("answer") ?? "") };
  const parsed = parseFaq(values);
  if (!parsed.success) return { values, fieldErrors: parsed.fieldErrors };

  const supabase = await createClient();
  if (id) {
    if (!itemId.safeParse(id).success) return { values, error: "This question no longer exists." };
    const { data, error } = await supabase.from("faq_items").update(parsed.data).eq("id", id).select("id");
    if (error) {
      console.error("Saving FAQ question failed", error);
      return { values, error: "We couldn't save this question. Please try again." };
    }
    if (data.length === 0) return { values, error: "This question no longer exists." };
    redirect("/settings/faq?notice=saved");
  }

  const { error } = await supabase.from("faq_items").insert({ ...parsed.data, business_id: business.id });
  if (error) {
    if (error.code === "22023") return { values, error: `${error.message}.` };
    console.error("Adding FAQ question failed", error);
    return { values, error: "We couldn't add this question. Please try again." };
  }
  redirect("/settings/faq?notice=added");
}

export async function deleteFaqItem(id: string): Promise<{ error?: string }> {
  await requireOwner();
  if (!itemId.safeParse(id).success) return { error: "This question no longer exists." };
  const supabase = await createClient();
  const { error } = await supabase.from("faq_items").delete().eq("id", id);
  if (error) {
    console.error("Removing FAQ question failed", error);
    return { error: "We couldn't remove this question. Please try again." };
  }
  redirect("/settings/faq?notice=removed");
}

export async function moveFaqItem(id: string, up: boolean): Promise<void> {
  await requireOwner();
  if (!itemId.safeParse(id).success) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("move_faq_item", { item_id: id, up });
  if (error && error.code !== "P0002") console.error("Moving FAQ question failed", error);
  refresh();
}
