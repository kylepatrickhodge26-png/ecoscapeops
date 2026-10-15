"use server";

import { visitorHash } from "@/lib/requests/ip";
import { EMPTY_REQUEST, parseRequest, requestValuesFromFormData, type RequestField, type RequestFormValues } from "@/lib/requests/schema";
import { createClient } from "@/lib/supabase/server";

export type RequestFormState = {
  values: RequestFormValues;
  fieldErrors?: Partial<Record<RequestField, string>>;
  error?: string;
  sent?: boolean;
};

const TOKEN = /^[0-9a-f]{64}$/;

// A visitor's request. No sign-in: the secret link is the only key, and the database decides
// whether it works and applies the limits. Nothing is returned except "sent" or a message.
export async function submitRequest(token: string, _prev: RequestFormState, formData: FormData): Promise<RequestFormState> {
  const values = requestValuesFromFormData(formData);
  const parsed = parseRequest(values);
  if (!parsed.success) return { values, fieldErrors: parsed.fieldErrors };

  // Honeypot: a field people can't see and bots fill in. Pretend it worked, store nothing.
  if (String(formData.get("website") ?? "") !== "") return { values: EMPTY_REQUEST, sent: true };
  if (!TOKEN.test(token)) return { values, error: "This form isn't available right now." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_request", {
    token,
    ...parsed.data,
    ip_hash: await visitorHash(),
  });
  if (error) {
    // These codes carry messages written for the visitor (limits, missing fields, link off).
    if (error.code === "P0429" || error.code === "22023" || error.code === "P0002") return { values, error: `${error.message}.` };
    console.error("Submitting request failed", error);
    return { values, error: "We couldn't send your request. Please try again." };
  }
  return { values: EMPTY_REQUEST, sent: true };
}
