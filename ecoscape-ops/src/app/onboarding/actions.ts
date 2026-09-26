"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getUser } from "@/lib/auth";
import { timeZoneFromFormData } from "@/lib/time-zone";
import { createClient } from "@/lib/supabase/server";

export type OnboardingState = { error?: string; business_name?: string };

const businessName = z
  .string()
  .trim()
  .min(1, "Enter your business name")
  .max(120, "Business name must be 120 characters or fewer");

export async function createBusiness(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  const raw = String(formData.get("business_name") ?? "");
  const parsed = businessName.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message, business_name: raw };

  if (!(await getUser())) redirect("/login");

  const supabase = await createClient();
  const { error } = await supabase.rpc("create_business", {
    business_name: parsed.data,
    time_zone: timeZoneFromFormData(formData),
  });
  // 23505: this account already has a business (e.g. a double submit) — just carry on.
  if (error && error.code !== "23505") {
    console.error("create_business failed", error);
    return { error: "We couldn't create your business. Please try again.", business_name: raw };
  }

  redirect("/customers");
}
