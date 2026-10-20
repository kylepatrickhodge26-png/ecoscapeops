// A business's questions and answers, as their customers see them. Everything is shown
// as plain text.
export function PublicFaq({ items, heading = "Questions & answers" }: { items: { question: string; answer: string }[]; heading?: string }) {
  if (items.length === 0) return null;
  return (
    <section className="panel public-faq" aria-labelledby="public-faq" data-testid="public-faq">
      <div className="panel-head">
        <h3 id="public-faq">{heading}</h3>
      </div>
      <div className="faq-list">
        {items.map((item, i) => (
          <details key={i}>
            <summary>{item.question}</summary>
            <div>
              <p className="pre-line">{item.answer}</p>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
