"use client";

export function PrintButton() {
  return (
    <button type="button" className="btn secondary small" onClick={() => window.print()}>
      Print
    </button>
  );
}
