import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@acropolisos/sdk": path.resolve(__dirname, "lib/sdk/index.ts"),
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // book-club-instance and empty-instance are gitignored runtime copies of
    // lib/ (the :3031 / :3032 demos) — their duplicated *.test.ts must not run
    // here (mirrors the tsconfig exclude; the @/ alias resolves @/lib/... to the
    // canonical tree anyway, so a stale copy would fail against current source).
    exclude: [
      "node_modules",
      ".next",
      "**/book-club-instance/**",
      "**/empty-instance/**",
    ],
  },
});
