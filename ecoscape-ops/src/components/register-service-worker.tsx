"use client";

import { useEffect } from "react";

// Registers the offline-page service worker (public/sw.js). Production only, so local
// development never fights a stale worker.
export function RegisterServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Installing is optional; the app works fine without the worker.
    });
  }, []);
  return null;
}
