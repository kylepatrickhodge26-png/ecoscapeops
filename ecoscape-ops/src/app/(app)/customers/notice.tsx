export function Notice({ tone, children }: { tone: "success" | "error" | "warn"; children: React.ReactNode }) {
  return (
    <div className={`notice ${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}
