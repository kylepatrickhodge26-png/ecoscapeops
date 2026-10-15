import Link from "next/link";

export default function QuoteNotFound() {
  return (
    <div className="panel">
      <div className="empty">
        <div className="big">Quote not found</div>
        <p>This quote doesn&apos;t exist or has been deleted.</p>
        <Link className="btn secondary small" href="/quotes">
          Back to quotes
        </Link>
      </div>
    </div>
  );
}
