import { INVOICE_STATUS_LABELS, isInvoiceStatus } from "@/lib/invoices/constants";

// An invoice's live status (display_status from the database), as a labelled pill.
export function InvoiceStatusPill({ status }: { status: string | null }) {
  const known = isInvoiceStatus(status) ? status : "draft";
  return (
    <span className={`pill invoice-${known}`} data-invoice-status={known}>
      {INVOICE_STATUS_LABELS[known]}
    </span>
  );
}
