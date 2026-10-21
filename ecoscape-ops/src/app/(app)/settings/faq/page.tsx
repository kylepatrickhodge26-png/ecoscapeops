import type { Metadata } from "next";
import Link from "next/link";

import { ConfirmButton } from "@/components/confirm-button";
import { Notice } from "@/components/notice";
import { requireOwner } from "@/lib/auth";
import { FAQ_MAX_ITEMS, unusedSuggestions } from "@/lib/faq";
import { createClient } from "@/lib/supabase/server";

import { deleteFaqItem, moveFaqItem } from "./actions";
import { FaqForm } from "./faq-form";

export const metadata: Metadata = { title: "Customer FAQ" };

const NOTICES: Record<string, string> = {
  added: "Question added. Customers see it on their account page and your request form.",
  saved: "Question saved.",
  removed: "Question removed.",
};

// The owner's questions and answers for their customers: add, edit, reorder, remove.
export default async function CustomerFaqPage(props: PageProps<"/settings/faq">) {
  const { business } = await requireOwner();
  const { notice, edit } = await props.searchParams;
  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("faq_items")
    .select("id, question, answer")
    .eq("business_id", business.id)
    .order("position");
  if (error) throw new Error(`Could not load your FAQ: ${error.message}`);

  const editing = typeof edit === "string" ? items.find((i) => i.id === edit) : undefined;
  const full = items.length >= FAQ_MAX_ITEMS;

  return (
    <>
      <div className="pagehead">
        <div>
          <Link className="backlink" href="/settings">
            ← Settings
          </Link>
          <h1>Customer FAQ</h1>
          <div className="meta">Answers to what customers always ask, shown on their account page and your request form</div>
        </div>
      </div>
      {typeof notice === "string" && NOTICES[notice] && <Notice tone="success">{NOTICES[notice]}</Notice>}

      <div className="panel">
        <div className="panel-head">
          <h3>{editing ? "Edit question" : "Add a question"}</h3>
        </div>
        <div className="panel-body">
          {editing ? (
            <FaqForm key={editing.id} id={editing.id} initial={{ question: editing.question, answer: editing.answer }} />
          ) : full ? (
            <p className="hint">You have {FAQ_MAX_ITEMS} questions, the most there can be. Remove one to add another.</p>
          ) : (
            <FaqForm key="new" id={null} initial={{ question: "", answer: "" }} suggestions={unusedSuggestions(items.map((i) => i.question))} />
          )}
        </div>
      </div>

      <section className="panel" aria-labelledby="faq-yours" data-testid="faq-items">
        <div className="panel-head">
          <h3 id="faq-yours">Your questions ({items.length})</h3>
        </div>
        {items.length === 0 ? (
          <div className="empty">
            <div className="big">No questions yet</div>
            Add the questions customers ask you most, like what happens on a rain day or how to pay.
          </div>
        ) : (
          <ol className="faq-editor">
            {items.map((item, i) => (
              <li key={item.id} data-faq={item.question}>
                <div className="faq-row">
                  <div className="faq-moves">
                    <form action={moveFaqItem.bind(null, item.id, true)}>
                      <button type="submit" className="btn secondary small" disabled={i === 0} aria-label={`Move "${item.question}" up`}>
                        ↑
                      </button>
                    </form>
                    <form action={moveFaqItem.bind(null, item.id, false)}>
                      <button type="submit" className="btn secondary small" disabled={i === items.length - 1} aria-label={`Move "${item.question}" down`}>
                        ↓
                      </button>
                    </form>
                  </div>
                  <div className="faq-text">
                    <b>{item.question}</b>
                    <p className="pre-line subtext">{item.answer}</p>
                    <div className="form-actions">
                      <Link className="btn secondary small" href={`/settings/faq?edit=${item.id}`}>
                        Edit
                      </Link>
                      <ConfirmButton
                        action={deleteFaqItem.bind(null, item.id)}
                        label="Remove"
                        confirmText={<>Remove &ldquo;{item.question}&rdquo;? Customers won&apos;t see it any more.</>}
                        confirmLabel="Yes, remove it"
                        pendingLabel="Removing…"
                      />
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
