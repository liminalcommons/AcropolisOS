// Drift-guard for the static FUNCTION_REGISTRY.
//
// The registry (function-registry.ts) holds STATIC default-imports of every
// `functions/<functionName>.ts` descriptor so the loader's common path is
// Turbopack-bundlable (a fully dynamic `import(fileUrl)` throws "Cannot find
// module as expression is too dynamic" in the Next.js server runtime).
//
// The risk is silent drift: someone adds a new function-backed action (a
// `functions/<fn>.ts` wired from an ontology action's `function:` field) but
// forgets to register it. In dev/test the dynamic fallback would still resolve
// it, hiding the gap — until it ships and Turbopack can't bundle the dynamic
// import. This test closes that gap: for every action whose `function:` has a
// real file, the registry MUST carry a valid descriptor.
//
// `claim-shift` is declared in the ontology but has NO functions/claim-shift.ts
// file (a known-missing handler); this test SKIPS it via the file-exists check,
// matching the loader, which lets the dynamic fallback report file-not-found.

import { stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isActionDescriptor } from "@/lib/sdk";
import { loadOntology } from "@/lib/ontology/load";
import { FUNCTION_REGISTRY } from "./function-registry";

const ONTOLOGY_ROOT = path.resolve(__dirname, "..", "..", "ontology");
const FUNCTIONS_DIR = path.resolve(__dirname, "..", "..", "functions");

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw err;
  }
}

describe("FUNCTION_REGISTRY — every registered value is a valid descriptor", () => {
  it("holds only defineAction descriptors", () => {
    for (const [name, value] of Object.entries(FUNCTION_REGISTRY)) {
      expect(
        isActionDescriptor(value),
        `registry["${name}"] must be a defineAction({ schema, handler }) descriptor`,
      ).toBe(true);
    }
  });
});

describe("FUNCTION_REGISTRY — no drift from the active ontology", () => {
  it("registers every function-backed action that has a functions/<fn>.ts file", async () => {
    const ontology = await loadOntology(ONTOLOGY_ROOT);

    let checked = 0;
    for (const [actionName, def] of Object.entries(ontology.action_types)) {
      const fn = def.function;
      if (!fn) continue;

      // Only enforce registration for functions that actually have a file.
      // A `function:` with no file (e.g. claim-shift) stays the loader's
      // dynamic-fallback / known-missing case.
      const hasFile = await fileExists(path.join(FUNCTIONS_DIR, `${fn}.ts`));
      if (!hasFile) continue;

      checked += 1;
      const registered = FUNCTION_REGISTRY[fn];
      expect(
        registered,
        `action "${actionName}" is wired to function "${fn}" (functions/${fn}.ts exists) but is NOT in FUNCTION_REGISTRY — add a static import`,
      ).toBeDefined();
      expect(
        isActionDescriptor(registered),
        `FUNCTION_REGISTRY["${fn}"] is not a valid defineAction descriptor`,
      ).toBe(true);
    }

    // Sanity: the loop actually exercised the active ontology's function-backed
    // actions (guards against an empty/misresolved ontology silently passing).
    expect(checked).toBeGreaterThan(0);
  });
});
