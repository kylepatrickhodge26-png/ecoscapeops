import { execFileSync } from "node:child_process";

import type { TestProject } from "vitest/node";

export type LocalSupabase = { url: string; publishableKey: string; secretKey: string };

declare module "vitest" {
  export interface ProvidedContext {
    supabase: LocalSupabase;
  }
}

// Reads the running local stack's URL and keys from the Supabase CLI.
export default function setup(project: TestProject) {
  let status: Record<string, string>;
  try {
    status = JSON.parse(execFileSync("npx", ["supabase", "status", "-o", "json"], { encoding: "utf8" }));
  } catch (error) {
    throw new Error("Local Supabase isn't running. Start it with `npx supabase start`, then re-run the tests.", {
      cause: error,
    });
  }

  project.provide("supabase", {
    url: status.API_URL,
    publishableKey: status.PUBLISHABLE_KEY,
    secretKey: status.SECRET_KEY,
  });
}
