import type { Metadata } from "next";
import { headers } from "next/headers";

import { ConfirmButton } from "@/components/confirm-button";
import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { formatShortDate } from "@/lib/dates";
import { createClient } from "@/lib/supabase/server";

import { CopyButton } from "../../pay/[token]/copy-button";
import { convertRequest, deleteRequest, dismissRequest, setRequestLink } from "./actions";
import { RegenerateButton } from "./regenerate-button";

export const metadata: Metadata = { title: "Requests · EcoScape Ops" };

const NOTICES: Record<string, { tone: "success" | "error" | "warn"; text: string }> = {
  on: { tone: "success", text: "Your request form is on. Anyone with the link can send you a request." },
  off: { tone: "success", text: "Your request form is off. The link shows nothing until you turn it back on." },
  regenerated: { tone: "success", text: "New link made. The old one no longer works." },
  dismissed: { tone: "success", text: "Request dismissed." },
  deleted: { tone: "success", text: "Request deleted." },
  gone: { tone: "warn", text: "That request no longer exists." },
  failed: { tone: "error", text: "Something went wrong. Please try again." },
};

export default async function RequestsPage(props: PageProps<"/requests">) {
  const { business } = await requireOwner();
  const { notice } = await props.searchParams;
  const supabase = await createClient();

  const [{ data: link, error: linkError }, { data: requests, error }] = await Promise.all([
    supabase.rpc("request_link"),
    supabase
      .from("requests")
      .select("id, name, phone, email, address, details, status, customer_id, created_at")
      .eq("business_id", business.id)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  if (linkError || error || !link?.[0]) throw new Error(`Could not load requests: ${(linkError ?? error)?.message ?? "no link"}`);

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const url = `${proto}://${host}/request/${link[0].token}`;
  const enabled = link[0].enabled;

  const fresh = requests.filter((r) => r.status === "new");
  const handled = requests.filter((r) => r.status !== "new");
  const day = (iso: string) => formatShortDate(new Date(iso).toLocaleDateString("en-CA", { timeZone: business.time_zone }));

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Requests</h1>
          <div className="meta">People who asked for work through your link · Owner only</div>
        </div>
      </div>

      {typeof notice === "string" && NOTICES[notice] && <Notice tone={NOTICES[notice].tone}>{NOTICES[notice].text}</Notice>}

      <div className="panel" data-testid="request-link-panel">
        <div className="panel-head">
          <h3>Your request form</h3>
          <span className={`pill ${enabled ? "completed" : "cancelled"}`}>{enabled ? "On" : "Off"}</span>
        </div>
        <div className="panel-body">
          <p className="hint">
            Share this link on your website, flyers or in a text. Visitors see your business name and a form, nothing else, and don&apos;t need an
            account.
          </p>
          <div className="share-link">
            <code data-testid="request-link">{url}</code>
            <CopyButton text={url} label="Copy link" />
          </div>
          <div className="head-actions">
            <form action={setRequestLink.bind(null, !enabled)}>
              <button className={`btn small ${enabled ? "secondary" : ""}`} type="submit">
                {enabled ? "Turn off" : "Turn on"}
              </button>
            </form>
            <RegenerateButton />
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>New ({fresh.length})</h3>
        </div>
        <div className="panel-body">
          {fresh.length === 0 ? (
            <div className="empty">No new requests.</div>
          ) : (
            <ul className="request-list">
              {fresh.map((r) => (
                <li key={r.id} data-request={r.name}>
                  <RequestBody r={r} date={day(r.created_at)} />
                  <form action={convertRequest.bind(null, r.id)} className="head-actions">
                    <button className="btn small" type="submit" name="next" value="quote">
                      Add customer + quote
                    </button>
                    <button className="btn small secondary" type="submit" name="next" value="book">
                      Add customer + book
                    </button>
                    <button className="btn small secondary" type="submit" name="next" value="customer">
                      Add customer
                    </button>
                  </form>
                  <form action={dismissRequest.bind(null, r.id)} className="head-actions">
                    <button className="btn small secondary" type="submit">
                      Dismiss
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {handled.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>Handled</h3>
          </div>
          <div className="panel-body">
            <ul className="request-list">
              {handled.map((r) => (
                <li key={r.id} data-request={r.name}>
                  <RequestBody r={r} date={day(r.created_at)} />
                  <div className="head-actions">
                    <span className={`pill ${r.status === "converted" ? "completed" : "cancelled"}`}>
                      {r.status === "converted" ? "Customer added" : "Dismissed"}
                    </span>
                    {r.customer_id && (
                      <a className="btn small secondary" href={`/customers/${r.customer_id}`}>
                        Open customer
                      </a>
                    )}
                    <ConfirmButton
                      action={deleteRequest.bind(null, r.id)}
                      label="Delete"
                      confirmLabel="Yes, delete"
                      pendingLabel="Deleting…"
                      confirmText={<>Delete the request from {r.name}? This can&apos;t be undone.</>}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}

// Everything here came from a stranger, so it is shown as plain text only (React escapes it).
function RequestBody({ r, date }: { r: { name: string; phone: string; email: string; address: string; details: string }; date: string }) {
  return (
    <div>
      <div>
        <b>{r.name}</b> <span className="subtext">· {date}</span>
      </div>
      <div className="subtext">{[r.phone, r.email, r.address].filter(Boolean).join(" · ")}</div>
      <p className="pre-line">{r.details}</p>
    </div>
  );
}
