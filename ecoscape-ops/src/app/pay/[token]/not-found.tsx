export default function PayNotFound() {
  return (
    <main className="pay-card">
      <div className="empty">
        <div className="big">Invoice not available</div>
        <p>This invoice link isn&apos;t valid, or the invoice has been cancelled. Please contact the business that sent it.</p>
      </div>
    </main>
  );
}
