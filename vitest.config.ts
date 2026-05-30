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
    // book-club-instance is a gitignored runtime copy of lib/ (the :3031 demo) —
    // its duplicated *.test.ts must not run here (mirrors the tsconfig exclude).
    exclude: ["node_modules", ".next", "**/book-club-instance/**"],
  },
});
