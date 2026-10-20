"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";

import { FAQ_ANSWER_MAX, FAQ_QUESTION_MAX, type FaqField, type FaqValues } from "@/lib/faq";

import { saveFaqItem, type FaqFormState } from "./actions";

// Add a question (id null) or edit one. When adding, common questions are one tap away;
// the owner always writes the answer.
export function FaqForm({ id, initial, suggestions = [] }: { id: string | null; initial: FaqValues; suggestions?: string[] }) {
  const [state, formAction, pending] = useActionState<FaqFormState, FormData>(saveFaqItem.bind(null, id), { values: initial });
  const question = useRef<HTMLInputElement>(null);
  const answer = useRef<HTMLTextAreaElement>(null);
  const errors = state.fieldErrors ?? {};
  const invalid = (name: FaqField) => ({
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `faq-${name}-error` : undefined,
  });

  return (
    <form key={JSON.stringify(state.values)} action={formAction} noValidate className="customer-form">
      {state.error && (
        <div className="notice error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="faq-question">Question</label>
        {!id && suggestions.length > 0 && (
          <div className="faq-suggestions" aria-label="Common questions">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="btn secondary small"
                onClick={() => {
                  if (question.current) question.current.value = s;
                  answer.current?.focus();
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <input ref={question} id="faq-question" name="question" defaultValue={state.values.question} maxLength={FAQ_QUESTION_MAX} placeholder="e.g. What happens if it rains?" {...invalid("question")} />
        {errors.question && (
          <div id="faq-question-error" className="field-error">
            {errors.question}
          </div>
        )}
      </div>
      <div className="field">
        <label htmlFor="faq-answer">Answer</label>
        <textarea ref={answer} id="faq-answer" name="answer" rows={4} defaultValue={state.values.answer} maxLength={FAQ_ANSWER_MAX} placeholder="e.g. We move your visit to the next dry day and text you the new date." {...invalid("answer")} />
        {errors.answer && (
          <div id="faq-answer-error" className="field-error">
            {errors.answer}
          </div>
        )}
      </div>
      <div className="form-actions">
        {id && (
          <Link className="btn secondary" href="/settings/faq">
            Cancel
          </Link>
        )}
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Saving…" : id ? "Save question" : "Add question"}
        </button>
      </div>
    </form>
  );
}

