import Link from "next/link";

export default function ExpenseNotFound() {
  return (
    <div className="panel">
      <div className="empty">
        <div className="big">Expense not found</div>
        <p>This expense doesn&apos;t exist or has been deleted.</p>
        <Link className="btn secondary small" href="/expenses">
          Back to expenses
        </Link>
      </div>
    </div>
  );
}
