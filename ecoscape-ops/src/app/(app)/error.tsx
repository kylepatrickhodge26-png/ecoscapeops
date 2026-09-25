"use client";

import { useEffect } from "react";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="panel">
      <div className="empty">
        <div className="big">Something went wrong</div>
        <p>We couldn&apos;t load this page. Check your connection and try again.</p>
        <button type="button" className="btn secondary small" onClick={() => retry()}>
          Try again
        </button>
      </div>
    </div>
  );
}
