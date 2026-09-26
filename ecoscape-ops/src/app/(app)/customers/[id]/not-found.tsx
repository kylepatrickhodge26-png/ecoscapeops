import Link from "next/link";

export default function CustomerNotFound() {
  return (
    <div className="panel">
      <div className="empty">
        <div className="big">Customer not found</div>
        <p>This customer doesn&apos;t exist or has been deleted.</p>
        <Link className="btn secondary small" href="/customers">
          Back to customers
        </Link>
      </div>
    </div>
  );
}
