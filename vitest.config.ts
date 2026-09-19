import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  // PGlite ships WASM + node filesystem shims; Vite must not pre-bundle it.
  optimizeDeps: { exclude: ["@electric-sql/pglite"] },
  ssr: { external: ["@electric-sql/pglite"] },
  test: {
    environment: "node",
    server: { deps: { external: ["@electric-sql/pglite"] } },
  },
});
