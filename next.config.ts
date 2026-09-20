import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM binary + filesystem shims that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],

  // In dev, Next.js blocks cross-origin requests to /_next/* (including the
  // HMR socket) unless the host is allowlisted. Sandbox preview URLs are
  // proxied under *.e2b.app and their subdomain changes whenever the sandbox
  // is recreated, so allow the pattern rather than a specific hostname.
  allowedDevOrigins: ["*.e2b.app", "*.vercel.app", "127.0.0.1", "localhost"],
};

export default nextConfig;
