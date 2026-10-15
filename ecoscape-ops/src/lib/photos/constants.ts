import type { Enums } from "@/lib/supabase/database.types";

export type PhotoKind = Enums<"photo_kind">;

export const PHOTO_KINDS = ["before", "after", "other"] as const satisfies readonly PhotoKind[];
export const PHOTO_KIND_LABELS: Record<PhotoKind, string> = { before: "Before", after: "After", other: "Other" };

export const PHOTO_BUCKET = "job-photos";
// Matches the database: a job holds at most this many photos.
export const MAX_PHOTOS_PER_JOB = 30;
// Photos are shrunk in the browser before upload (about 0.2 to 0.5 MB each).
export const MAX_DIMENSION = 1600;
export const JPEG_QUALITY = 0.8;
// Largest picture we'll try to open at all.
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
// What the Supabase free plan includes.
export const FREE_STORAGE_BYTES = 1024 * 1024 * 1024;
export const MAX_CAPTION = 200;

// The size to draw an image at so its longer side is at most `max`, never upscaling.
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

// <business>/<job>/<random>.jpg, the path the storage rules expect.
export const photoPath = (businessId: string, jobId: string, fileId: string) => `${businessId}/${jobId}/${fileId}.jpg`;

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
