"use client";

import { useMemo, useState } from "react";

import type { HelpTopic } from "@/lib/help";
import { answerQuestion } from "@/lib/help-answer";

// Type a question in your own words; the best answers show right under it as you type.
// Everything happens on the phone: nothing typed here is sent or saved anywhere.
export function AskBox({ topics, popular, initial }: { topics: HelpTopic[]; popular: string[]; initial: string }) {
  const [question, setQuestion] = useState(initial);
  const asked = question.trim();
  const answers = useMemo(() => (asked.length >= 2 ? answerQuestion(asked, topics) : []), [asked, topics]);
  const suggestions = popular.map((id) => topics.find((t) => t.id === id)).filter((t): t is HelpTopic => Boolean(t));

  return (
    <section className="panel ask-help" aria-labelledby="ask-label">
      <div className="panel-body">
        <form role="search" onSubmit={(e) => e.preventDefault()}>
          <label id="ask-label" htmlFor="ask" className="ask-label">
            Ask a question
          </label>
          <input
            id="ask"
            type="search"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. How do I move a job?"
            autoComplete="off"
            enterKeyHint="search"
            maxLength={200}
          />
        </form>
        <div className="ask-results" aria-live="polite" data-testid="ask-results">
          {asked.length < 2 ? (
            <div className="ask-suggest">
              <span className="hint">People often ask:</span>
              {suggestions.map((t) => (
                <button key={t.id} type="button" className="ask-chip" onClick={() => setQuestion(t.question)}>
                  {t.question}
                </button>
              ))}
            </div>
          ) : answers.length > 0 ? (
            answers.map((t, i) => (
              <article key={t.id} className={`ask-answer${i === 0 ? " best" : ""}`} data-topic={t.id}>
                <h4>{t.question}</h4>
                {t.answer.map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
              </article>
            ))
          ) : (
            <p className="hint">
              No answer for that yet. Try other words, like &ldquo;move a job&rdquo;, &ldquo;invoice&rdquo; or &ldquo;clock in&rdquo;, or
              look through the topics below.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
