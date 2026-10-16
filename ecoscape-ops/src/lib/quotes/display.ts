import { customerDisplayName } from "@/lib/customers/schema";

type Who = {
  prospect_name: string;
  customer: { first_name: string; last_name: string; phone: string; email: string } | null;
};

// Who a quote is for: the customer's name, or the prospect's.
export const quoteWho = (q: Who) => (q.customer ? customerDisplayName(q.customer) : q.prospect_name || "Unknown");
