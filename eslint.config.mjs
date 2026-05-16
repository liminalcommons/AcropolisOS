import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Sandbox guard for function-backed actions (US-025).
//
// Handlers in functions/**/*.ts may only reach the runtime through
// `ctx.objects.*`, `ctx.links.*`, and `ctx.actions.*` (i.e. the OntologyCtx
// surface provided by lib/ontology/ctx.ts). To keep the sandbox honest we
// block direct imports of:
//   - Node built-ins that grant FS / process / network escape hatches
//   - Drizzle / postgres / the local db module (raw DB access)
//   - The Inngest client (event escape hatch)
//   - next-auth / auth helpers (privilege escape)
// fetch and process are globals, not imports — those are caught at runtime
// because the SDK does not expose them on ctx; lint catches the import path.
const sandboxRestrictedPaths = [
  // Node built-ins
  "child_process",
  "node:child_process",
  "fs",
  "fs/promises",
  "node:fs",
  "node:fs/promises",
  "http",
  "https",
  "node:http",
  "node:https",
  "net",
  "node:net",
  "dns",
  "node:dns",
  "worker_threads",
  "node:worker_threads",
  "vm",
  "node:vm",
  "undici",
  // Database / persistence escape hatches
  "drizzle-orm",
  "postgres",
  // Inngest / auth escape hatches
  "inngest",
  "next-auth",
];

const sandboxRestrictedPatterns = [
  // Block deep imports of the local db module and any subpath of drizzle.
  { group: ["**/lib/db", "**/lib/db/**"], message: "function-backed handlers must use ctx.objects.* / ctx.links.* — raw db access is forbidden." },
  { group: ["drizzle-orm/*"], message: "function-backed handlers must use ctx.objects.* — drizzle is not in the sandbox." },
  { group: ["**/lib/auth", "**/lib/auth/**"], message: "function-backed handlers must rely on ctx.actor — auth helpers are not in the sandbox." },
  { group: ["**/lib/inngest", "**/lib/inngest/**"], message: "function-backed handlers cannot enqueue Inngest events directly." },
];

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  { ignores: [".next/**", "node_modules/**", "lib/actions/__test_fixtures__/**"] },
  {
    files: ["functions/**/*.ts", "functions/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: sandboxRestrictedPaths.map((p) => ({
            name: p,
            message:
              "function-backed handlers may only reach the runtime via ctx.objects.* / ctx.links.* / ctx.actions.* — raw DB / fs / net / process / auth imports are not allowed.",
          })),
          patterns: sandboxRestrictedPatterns,
        },
      ],
    },
  },
];

export default config;
