import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { PHOTO_BUCKET } from "./constants";

type Client = SupabaseClient<Database>;

// Photo files live in Storage, not the database, so deleting a job or customer would leave
// them behind (still counting against the free 1 GB). Call this BEFORE the delete, while the
// owner can still see which files belong to it. Never blocks the delete: failures are logged.
export async function removePhotoFiles(supabase: Client, scope: { jobId?: string; customerId?: string }) {
  try {
    let query = supabase.from("job_photos").select("storage_path, jobs!inner(customer_id)").limit(5000);
    if (scope.jobId) query = query.eq("job_id", scope.jobId);
    if (scope.customerId) query = query.eq("jobs.customer_id", scope.customerId);
    const { data, error } = await query;
    if (error) throw error;
    const paths = data.map((p) => p.storage_path);
    for (let i = 0; i < paths.length; i += 100) {
      const { error: removeError } = await supabase.storage.from(PHOTO_BUCKET).remove(paths.slice(i, i + 100));
      if (removeError) throw removeError;
    }
  } catch (error) {
    console.error("Removing photo files failed", error);
  }
}
