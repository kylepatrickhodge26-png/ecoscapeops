import type { Metadata } from "next";
import Link from "next/link";

import { requireMembership } from "@/lib/auth";
import { helpFor, helpSections } from "@/lib/help";
import { POPULAR_QUESTIONS } from "@/lib/help-answer";

import { AskBox } from "./ask-box";
import { OpenFromLink } from "./open-from-link";

export const metadata: Metadata = { title: "Help" };

const slug = (section: string) => `section-${section.toLowerCase().replace(/[^a-z]+/g, "-")}`;

// How to use the app, for the owner and for crew. Crew see only what applies to them.
export default async function HelpPage(props: PageProps<"/help">) {
  const { role } = await requireMembership();
  const { q } = await props.searchParams;
  const who = role === "owner" ? "owner" : "crew";
  const topics = helpFor(who);
  const sections = helpSections(topics);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>Help</h1>
          <div className="meta">Ask in your own words, or tap a question below</div>
        </div>
      </div>
      <AskBox topics={topics} popular={POPULAR_QUESTIONS[who]} initial={typeof q === "string" ? q.slice(0, 200) : ""} />
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
