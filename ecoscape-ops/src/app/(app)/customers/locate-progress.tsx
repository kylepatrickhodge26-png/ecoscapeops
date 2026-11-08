"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { locateWaitingCustomers } from "./actions";

// Looks up the customers' addresses that are still waiting (after an import, say), a batch at
// a time while this page is open, so their visits can go in route order. No scheduled job:
// it stops when you leave, and picks up again next time.
export function LocateProgress({ waiting }: { waiting: number }) {
  const router = useRouter();
  const [left, setLeft] = useState(waiting);
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let last = waiting;
      while (!cancelled) {
        const { remaining } = await locateWaitingCustomers();
        if (cancelled) return;
        if (remaining < 0 || remaining >= last) {
          // The lookup service is down, or the rest can't be found: try again another time.
          setStuck(true);
          break;
        }
        setLeft(remaining);
        last = remaining;
        if (remaining === 0) break;
      }
      if (!cancelled) router.refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [waiting, router]);

  return (
    <div className="notice" role="status">
      {stuck ? (
        <>
          {left} {left === 1 ? "address is" : "addresses are"} still waiting to be looked up. They&apos;ll be tried again next
          time, or from Settings.
        </>
      ) : (
        <span className="locate-progress">
          Looking up your customers&apos; addresses for route order: {left} to go…
        </span>
      )}
    </div>
  );
}
