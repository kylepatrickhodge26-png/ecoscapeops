import { ConfirmButton } from "@/components/confirm-button";
import { requireMembership } from "@/lib/auth";
import { formatShortDate } from "@/lib/dates";
import { PHOTO_BUCKET, PHOTO_KIND_LABELS } from "@/lib/photos/constants";
import { createClient } from "@/lib/supabase/server";

import { removeJobPhoto } from "./actions";
import { ChecklistPanel } from "./checklist-panel";
import { PhotoUploader } from "./photo-uploader";

// A job's checklist and photos, for the owner (who can also remove photos) or the crew member
// it's assigned to. Only shows what the database lets this person see.
export async function JobExtras({ jobId, canDelete = false }: { jobId: string; canDelete?: boolean }) {
  const { business } = await requireMembership();
  const supabase = await createClient();
  const [{ data: items, error: itemsError }, { data: photos, error: photosError }] = await Promise.all([
    supabase.rpc("job_checklist", { job_id: jobId }),
    supabase.rpc("job_photos_for", { job_id: jobId }),
  ]);
  if (itemsError || photosError) throw new Error(`Could not load the job's checklist and photos: ${(itemsError ?? photosError)!.message}`);

  // Private files are shown through short-lived links made as this user.
  const urls = new Map<string, string>();
  if (photos.length > 0) {
    const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(
      photos.map((p) => p.storage_path),
      3600,
    );
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  const done = items.filter((i) => i.done).length;

  return (
    <div className="job-extras">
      {items.length > 0 && (
        <details className="extras-section" open={done < items.length}>
          <summary>
            Checklist ({done}/{items.length})
          </summary>
          <ChecklistPanel items={items} />
        </details>
      )}
      <details className="extras-section" open={photos.length > 0}>
        <summary>Photos ({photos.length})</summary>
        {photos.length > 0 && (
          <ul className="photo-grid" data-testid="job-photos">
            {photos.map((p) => (
              <li key={p.id} data-photo-kind={p.kind}>
                {urls.get(p.storage_path) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={urls.get(p.storage_path)} alt={p.caption || `${PHOTO_KIND_LABELS[p.kind]} photo`} loading="lazy" />
                ) : (
                  <div className="photo-missing">Photo unavailable</div>
                )}
                <div className="photo-meta">
                  <span className={`pill photo-${p.kind}`}>{PHOTO_KIND_LABELS[p.kind]}</span>
                  {p.caption && <span> {p.caption}</span>}
                  <div className="subtext">
                    {p.uploaded_by_name || "Someone"}, {formatShortDate(p.created_at.slice(0, 10))}
                  </div>
                  {canDelete && (
                    <ConfirmButton
                      action={removeJobPhoto.bind(null, p.id)}
                      label="Remove"
                      confirmLabel="Remove photo"
                      pendingLabel="Removing…"
                      confirmText={<>Remove this photo? This can&apos;t be undone.</>}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <PhotoUploader businessId={business.id} jobId={jobId} existing={photos.length} />
      </details>
    </div>
  );
}
