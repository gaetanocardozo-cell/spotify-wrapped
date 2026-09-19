import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships a WASM binary + filesystem shims that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
