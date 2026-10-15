export default function RequestLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="pay-shell">
      {children}
      <p className="pay-foot">Powered by EcoScape Ops</p>
    </div>
  );
}
