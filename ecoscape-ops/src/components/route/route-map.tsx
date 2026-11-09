"use client";

import "leaflet/dist/leaflet.css";

import { useEffect, useRef } from "react";

export type MapStop = { n: number; name: string; lat: number; lon: number; done?: boolean; next?: boolean };

// Today's route on a map: numbered pins in route order joined by a line, the next stop in green.
// Leaflet touches the page directly, so it's loaded only in the browser, after the page shows.
export function RouteMap({ stops, label }: { stops: MapStop[]; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(stops);

  useEffect(() => {
    const node = el.current;
    if (!node || stops.length === 0) return;
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    void import("leaflet").then((L) => {
      if (cancelled || !node) return;
      map = L.map(node, { zoomControl: false, attributionControl: true, scrollWheelZoom: false });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const points = stops.map((s) => L.latLng(s.lat, s.lon));
      if (points.length > 1) L.polyline(points, { color: "#2e6b3a", weight: 4, opacity: 0.85 }).addTo(map);
      for (const s of stops) {
        const cls = `route-pin${s.next ? " next" : ""}${s.done ? " done" : ""}`;
        L.marker([s.lat, s.lon], {
          title: s.name,
          icon: L.divIcon({ className: "route-pin-wrap", html: `<span class="${cls}">${s.n}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }),
        }).addTo(map);
      }
      map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 16 });
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
    // `key` stands for the stops' contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (stops.length === 0) return null;
  return <div ref={el} className="route-map" role="img" aria-label={label} data-testid="route-map" />;
}
