"use client";

import { ConfirmButton } from "@/components/confirm-button";

import type { DeleteCustomerState } from "../actions";

type Props = {
  action: (state: DeleteCustomerState) => Promise<DeleteCustomerState>;
  customerName: string;
  visitCount: number;
  invoiceCount: number;
};

export function DeleteCustomerButton({ action, customerName, visitCount, invoiceCount }: Props) {
  return (
    <ConfirmButton
      action={action}
      label="Delete"
      confirmLabel="Yes, delete"
      pendingLabel="Deleting…"
      confirmText={
        <>
          Delete <b>{customerName}</b>?{" "}
          {visitCount > 0 &&
            `This also permanently deletes their ${visitCount} ${visitCount === 1 ? "visit" : "visits"} and booked services. `}
          {invoiceCount > 0 &&
            `It deletes their ${invoiceCount} ${invoiceCount === 1 ? "invoice" : "invoices"} and payment records too. `}
          This can&apos;t be undone.
        </>
      }
    />
  );
}
