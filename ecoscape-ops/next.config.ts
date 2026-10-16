import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The bundled ZIP code list is large; load it with Node's require instead of bundling it.
  serverExternalPackages: ["zipcodes"],
  async headers() {
    return [
      // The service worker must never be served from a cache, or updates would stall.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "text/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
