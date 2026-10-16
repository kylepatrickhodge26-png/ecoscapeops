"use client";

import { useRef, useState } from "react";

import { compressImage } from "@/lib/photos/compress";
import { MAX_CAPTION, MAX_PHOTOS_PER_JOB, PHOTO_BUCKET, PHOTO_KINDS, PHOTO_KIND_LABELS, photoPath, type PhotoKind } from "@/lib/photos/constants";
import { createClient } from "@/lib/supabase/client";

import { recordJobPhoto } from "./actions";

// Add photos to a job: pick or take pictures, they're shrunk here in the browser, uploaded
// straight to private storage, then recorded against the job.
export function PhotoUploader({ businessId, jobId, existing }: { businessId: string; jobId: string; existing: number }) {
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<PhotoKind>("before");
  const [caption, setCaption] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const room = MAX_PHOTOS_PER_JOB - existing;

  async function onPick(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const picked = Array.from(files).slice(0, Math.max(room, 0));
    if (picked.length < files.length) setError(`A job can have at most ${MAX_PHOTOS_PER_JOB} photos, so only the first ${picked.length} were added.`);
    setBusy(true);
    const supabase = createClient();
    let added = 0;
    try {
      for (const [index, file] of picked.entries()) {
        setStatus(`Uploading ${index + 1} of ${picked.length}…`);
        const blob = await compressImage(file);
        const path = photoPath(businessId, jobId, crypto.randomUUID());
        const { error: uploadError } = await supabase.storage.from(PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: false });
        if (uploadError) {
          console.error("Photo upload failed", uploadError);
          throw new Error("We couldn't upload that photo. If this keeps happening, your photo storage may be full.");
        }
        const result = await recordJobPhoto(jobId, path, kind, caption.trim());
        if (result.error) throw new Error(result.error);
        added += 1;
      }
      setCaption("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't add that photo.");
    } finally {
      setBusy(false);
      setStatus(added > 0 ? `Added ${added} photo${added === 1 ? "" : "s"}.` : null);
      if (input.current) input.current.value = "";
    }
  }

  if (room <= 0) return <p className="hint">This job has the most photos it can hold ({MAX_PHOTOS_PER_JOB}).</p>;

  return (
    <div className="photo-uploader">
      <div className="row2">
        <div className="field">
          <label htmlFor={`photo-kind-${jobId}`}>Photo is</label>
          <select id={`photo-kind-${jobId}`} value={kind} onChange={(e) => setKind(e.target.value as PhotoKind)} disabled={busy}>
            {PHOTO_KINDS.map((k) => (
              <option key={k} value={k}>
                {PHOTO_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`photo-caption-${jobId}`}>Caption (optional)</label>
          <input id={`photo-caption-${jobId}`} value={caption} maxLength={MAX_CAPTION} onChange={(e) => setCaption(e.target.value)} disabled={busy} />
        </div>
      </div>
      <label className={`btn secondary small${busy ? " disabled" : ""}`}>
        {busy ? "Uploading…" : "Add photos"}
        <input
          ref={input}
          type="file"
          accept="image/*"
          multiple
          className="visually-hidden"
          disabled={busy}
          onChange={(e) => onPick(e.target.files)}
          aria-label="Add photos"
        />
      </label>
      {status && (
        <p className="hint" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
