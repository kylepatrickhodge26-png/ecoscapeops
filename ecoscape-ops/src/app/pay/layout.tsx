import { APP_NAME } from "@/lib/brand";

export default function PayLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pay-shell">
      {children}
      <p className="pay-foot">Invoicing by {APP_NAME}</p>
    </div>
  );
}
