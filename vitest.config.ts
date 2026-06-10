import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Pure mapper/unit tests only (no DOM) — node environment keeps the
    // dependency surface minimal (no jsdom needed).
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
