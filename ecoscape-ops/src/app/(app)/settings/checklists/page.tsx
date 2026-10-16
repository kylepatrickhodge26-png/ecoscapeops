import type { Metadata } from "next";
import Link from "next/link";

import { ConfirmButton } from "@/components/confirm-button";
import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { FREE_STORAGE_BYTES, formatBytes } from "@/lib/photos/constants";
import { createClient } from "@/lib/supabase/server";

import { removeChecklist } from "./actions";
import { ChecklistForm } from "./checklist-form";

export const metadata: Metadata = { title: "Checklists & photos" };

const NOTICES: Record<string, string> = {
  saved: "Checklist saved. New visits of this service get it, and so do upcoming visits that didn't have one.",
  removed: "Checklist removed. Visits that already have it keep their copy.",
};

export default async function ChecklistsPage(props: PageProps<"/settings/checklists">) {
  const { business } = await requireOwner();
  const { notice, service } = await props.searchParams;
  const supabase = await createClient();
  const [{ data: templates, error }, { data: plans, error: plansError }, { data: usage, error: usageError }] = await Promise.all([
    supabase
      .from("checklist_templates")
      .select("id, service_name, checklist_template_items(position, label)")
      .eq("business_id", business.id)
      .order("service_name")
      .order("position", { referencedTable: "checklist_template_items" }),
    supabase.from("service_plans").select("service_name").eq("business_id", business.id).limit(500),
    supabase.rpc("photo_usage"),
  ]);
  if (error || plansError || usageError) throw new Error(`Could not load checklists: ${(error ?? plansError ?? usageError)!.message}`);

  const serviceNames = [...new Set([...plans.map((p) => p.service_name), ...templates.map((t) => t.service_name)])].sort((a, b) => a.localeCompare(b));
  const editing = typeof service === "string" ? templates.find((t) => t.service_name === service) : undefined;
  const used = usage?.[0]?.total_bytes ?? 0;
  const photoCount = usage?.[0]?.photo_count ?? 0;

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/settings">
            ← Settings
          </Link>
          <h1>Checklists &amp; photos</h1>
          <div className="meta">Crew tick these off on each visit and add before/after photos</div>
        </div>
      </div>
      {typeof notice === "string" && NOTICES[notice] && <Notice tone="success">{NOTICES[notice]}</Notice>}

      <div className="panel">
        <div className="panel-head">
          <h3>{editing ? `Edit checklist for ${editing.service_name}` : "Add a checklist"}</h3>
        </div>
        <div className="panel-body">
          <ChecklistForm
            initial={{
              service_name: editing?.service_name ?? "",
              items: editing ? editing.checklist_template_items.map((i) => i.label).join("\n") : "",
            }}
            serviceNames={serviceNames}
          />
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Your checklists</h3>
        </div>
        <div className="panel-body">
          {templates.length === 0 ? (
            <p className="hint">None yet. Add one above, for example &ldquo;Mow, edge, blow, bag clippings&rdquo; for Mowing.</p>
          ) : (
            <ul className="template-list">
              {templates.map((t) => (
                <li key={t.id} data-template={t.service_name}>
                  <div>
                    <b>{t.service_name}</b>
                    <div className="subtext">{t.checklist_template_items.map((i) => i.label).join(" · ")}</div>
                  </div>
                  <div className="head-actions">
                    <Link className="btn secondary small" href={`/settings/checklists?service=${encodeURIComponent(t.service_name)}`}>
                      Edit
                    </Link>
                    <ConfirmButton
                      action={removeChecklist.bind(null, t.service_name)}
                      label="Remove"
                      confirmLabel="Remove checklist"
                      pendingLabel="Removing…"
                      confirmText={<>Remove the checklist for {t.service_name}? Visits that already have it keep their copy.</>}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Photo storage</h3>
        </div>
        <div className="panel-body">
          <p data-testid="photo-usage">
            <b>{photoCount}</b> {photoCount === 1 ? "photo" : "photos"} using <b>{formatBytes(used)}</b> of the {formatBytes(FREE_STORAGE_BYTES)} the free
            Supabase plan includes (shared with everything else in your project).
          </p>
          <p className="hint">
            Photos are shrunk on the phone before uploading (usually 200 to 500 KB each), so 1 GB holds a couple of thousand. When storage is
            full, uploads fail with a message and nothing else breaks. Remove photos you no longer need from a visit&apos;s page.
          </p>
        </div>
      </div>
    </>
  );
}
