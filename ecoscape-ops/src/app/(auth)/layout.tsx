export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <div className="name">EcoScape Ops</div>
        <div className="sub">Run your landscaping business</div>
      </div>
      <div className="auth-card">{children}</div>
    </div>
  );
}
