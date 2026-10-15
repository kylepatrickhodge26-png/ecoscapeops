"use server";

import { redirect } from "next/navigation";

import { requireOwner } from "@/lib/auth";
import { checklistSchema, parseChecklistLines } from "@/lib/photos/checklist";
import { createClient } from "@/lib/supabase/server";

export type ChecklistFormState = { values: { service_name: string; items: string }; error?: string };

// Saves a service's checklist (one item per line). Saving none removes it.
export async function saveChecklist(_prev: ChecklistFormState, formData: FormData): Promise<ChecklistFormState> {
  await requireOwner();
  const values = { service_name: String(formData.get("service_name") ?? ""), items: String(formData.get("items") ?? "") };
  const parsed = checklistSchema.safeParse({ service_name: values.service_name, items: parseChecklistLines(values.items) });
  if (!parsed.success) return { values, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_checklist_template", { service_name: parsed.data.service_name, items: parsed.data.items });
  if (error) {
    if (error.code === "22023") return { values, error: `${error.message}.` };
    console.error("Saving checklist failed", error);
    return { values, error: "We couldn't save this checklist. Please try again." };
  }
  redirect(`/settings/checklists?notice=${parsed.data.items.length === 0 ? "removed" : "saved"}`);
}

export async function removeChecklist(serviceName: string): Promise<{ error?: string }> {
  await requireOwner();
  const supabase = await createClient();
  const { error } = await supabase.rpc("save_checklist_template", { service_name: serviceName, items: [] });
  if (error) {
    console.error("Removing checklist failed", error);
    return { error: "We couldn't remove this checklist. Please try again." };
  }
  redirect("/settings/checklists?notice=removed");
}
