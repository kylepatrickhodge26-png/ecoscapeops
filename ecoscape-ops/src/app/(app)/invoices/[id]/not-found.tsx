import Link from "next/link";

export default function InvoiceNotFound() {
  return (
    <div className="panel">
      <div className="empty">
        <div className="big">Invoice not found</div>
        <p>This invoice doesn&apos;t exist or has been deleted.</p>
        <Link className="btn secondary small" href="/invoices">
          Back to invoices
        </Link>
      </div>
    </div>
  );
}
