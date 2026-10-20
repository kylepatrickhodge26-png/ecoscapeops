import type { Metadata } from "next";
import Link from "next/link";

import { requireMembership } from "@/lib/auth";
import { helpFor, helpSections } from "@/lib/help";

import { OpenFromLink } from "./open-from-link";

export const metadata: Metadata = { title: "Help" };

const slug = (section: string) => `section-${section.toLowerCase().replace(/[^a-z]+/g, "-")}`;

// How to use the app, for the owner and for crew. Crew see only what applies to them.
export default async function HelpPage() {
  const { role } = await requireMembership();
  const sections = helpSections(helpFor(role === "owner" ? "owner" : "crew"));

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Help</h1>
          <div className="meta">Tap a question to see the answer</div>
        </div>
      </div>
      <OpenFromLink />

      {sections.length > 1 && (
        <nav className="help-jump" aria-label="Help topics">
          {sections.map((s) => (
            <a key={s.section} href={`#${slug(s.section)}`}>
              {s.section}
            </a>
          ))}
        </nav>
      )}

      {sections.map((s) => (
        <section key={s.section} className="panel" id={slug(s.section)} aria-labelledby={`${slug(s.section)}-h`}>
          <div className="panel-head">
            <h3 id={`${slug(s.section)}-h`}>{s.section}</h3>
          </div>
          <div className="faq-list" data-testid="help-list">
            {s.topics.map((t) => (
              <details key={t.id} id={t.id}>
                <summary>{t.question}</summary>
                <div>
                  {t.answer.map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>
      ))}

      {role === "owner" ? (
        <p className="hint">
          Your customers have their own questions and answers: write them in <Link href="/settings/faq">Settings → Customer FAQ</Link>.
        </p>
      ) : (
        <p className="hint">Still stuck? Ask the owner of your business.</p>
      )}
    </>
  );
}
