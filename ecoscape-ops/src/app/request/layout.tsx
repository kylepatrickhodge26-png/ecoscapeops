import { APP_NAME } from "@/lib/brand";

export default function RequestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pay-shell">
      {children}
      <p className="pay-foot">Powered by {APP_NAME}</p>
    </div>
  );
}
