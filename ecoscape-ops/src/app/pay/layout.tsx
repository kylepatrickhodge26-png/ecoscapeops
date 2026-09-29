export default function PayLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pay-shell">
      {children}
      <p className="pay-foot">Invoicing by EcoScape Ops · Payments by Stripe</p>
    </div>
  );
}
