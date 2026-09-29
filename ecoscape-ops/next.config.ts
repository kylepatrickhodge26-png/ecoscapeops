import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The bundled ZIP code list is large; load it with Node's require instead of bundling it.
  serverExternalPackages: ["zipcodes"],
};

export default nextConfig;
