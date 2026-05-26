// Function-backed action runner.
//
// US-025: Drop a TS file in `functions/<action_name>.ts` whose default export
// is `defineAction({ schema, handler })` and it becomes runnable as an action.
// This module loads the file, validates the descriptor shape, parses params
// through the action's Zod schema, and invokes `handler({ params, ctx })`.
//
// The "sandbox" is best-effort and lives at three levels:
//   1. The SDK gives handlers only `{ params, ctx }` — there's no ambient
//      globals helper, no fetch wrapper, no DB handle.
//   2. ESLint blocks raw DB / fetch / child_process imports inside
//      `functions/**` (see eslint.config.mjs).
//   3. Anything not exposed on `ctx` is by construction unreachable through
//      the SDK surface; reaching it requires authors to opt into a banned
//      import, which step 2 catches at commit time.
//
// Runtime dynamic-import loading: vitest/Vite compiles TS on-the-fly during
// tests. In a Next.js / Inngest runtime, `functions/` is expected to be
// compiled (via `tsx`, a build step, or a bundler) so plain dynamic import
// resolves a module whose default export is a defineAction descriptor.

import { stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { OntologyCtx } from "../ontology/ctx";
import {
  type ActionDescriptor,
  type AnyZodSchema,
  isActionDescriptor,
} from "../sdk";
import { FUNCTION_REGISTRY } from "./function-registry";

export class FunctionBackedActionError extends Error {
  constructor(
    message: string,
    readonly functionName: string,
    readonly stage:
      | "resolve"
      | "import"
      | "shape"
      | "validate_params"
      | "handler",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FunctionBackedActionError";
  }
}

export interface LoadFunctionBackedActionInput {
  functionName: string;
  functionsDir: string;
  // Extensions to try, in order. Defaults cover dev (.ts via vitest/tsx) and
  // production (.js / .mjs after a build).
  extensions?: readonly string[];
}

const DEFAULT_EXTENSIONS = [".ts", ".mts", ".js", ".mjs"] as const;

// The canonical `functions/` directory the static FUNCTION_REGISTRY mirrors.
// Computed IDENTICALLY to chat-runtime's functionsDir (process.cwd() based) so
// the production call matches: under Turbopack `__dirname` is rewritten to a
// bundled-chunk path, so a __dirname-relative comparison never matched and the
// registry was silently skipped — falling through to the dynamic import that
// Turbopack cannot bundle ("expression is too dynamic"). process.cwd() is stable
// at runtime. Test fixtures use temp dirs (≠ this), so they still hit the dynamic
// path and the file on disk stays the source of truth for them.
const CANONICAL_FUNCTIONS_DIR = path.resolve(
  process.env.ACROPOLISOS_PKG_ROOT ?? process.cwd(),
  "functions",
);

function isCanonicalFunctionsDir(functionsDir: string): boolean {
  return path.resolve(functionsDir) === CANONICAL_FUNCTIONS_DIR;
}

async function resolveFunctionFile(
  input: LoadFunctionBackedActionInput,
): Promise<string> {
  const exts = input.extensions ?? DEFAULT_EXTENSIONS;
  for (const ext of exts) {
    const candidate = path.join(input.functionsDir, `${input.functionName}${ext}`);
    try {
      const s = await stat(candidate);
      if (s.isFile()) return candidate;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
  }
  throw new FunctionBackedActionError(
    `function file not found for "${input.functionName}" in ${input.functionsDir} (tried: ${exts.join(", ")})`,
    input.functionName,
    "resolve",
  );
}

export async function loadFunctionBackedAction(
  input: LoadFunctionBackedActionInput,
): Promise<ActionDescriptor<AnyZodSchema, unknown>> {
  // Registry-first (for the canonical functions dir): the common path is a
  // STATIC import so Turbopack can bundle it. A fully runtime-computed dynamic
  // import (the fallback below) throws "Cannot find module as expression is
  // too dynamic" in the Next.js server runtime. The registry returns the SAME
  // descriptor the file's default export does, so behavior is identical to the
  // dynamic path. We only consult the registry when the call targets the
  // canonical functions dir the registry mirrors — calls against a fixture
  // functionsDir must read that fixture's file, not the registered descriptor.
  if (isCanonicalFunctionsDir(input.functionsDir)) {
    const registered = FUNCTION_REGISTRY[input.functionName];
    if (registered !== undefined) {
      if (!isActionDescriptor(registered)) {
        throw new FunctionBackedActionError(
          `registry entry for "${input.functionName}" is not a defineAction descriptor`,
          input.functionName,
          "shape",
        );
      }
      return registered as ActionDescriptor<AnyZodSchema, unknown>;
    }
  }

  // Fallback for unregistered functions (e.g. test fixtures pointing at a
  // custom functionsDir, or a function with no static registry entry):
  // resolve the file on disk and dynamic-import it.
  const filePath = await resolveFunctionFile(input);
  const fileUrl = pathToFileURL(filePath).href;

  let mod: { default?: unknown };
  try {
    mod = (await import(/* @vite-ignore */ fileUrl)) as { default?: unknown };
  } catch (err) {
    throw new FunctionBackedActionError(
      `failed to import ${filePath}: ${(err as Error).message}`,
      input.functionName,
      "import",
      err,
    );
  }

  const descriptor = mod.default;
  if (!isActionDescriptor(descriptor)) {
    throw new FunctionBackedActionError(
      `${filePath}: default export is not a defineAction({ schema, handler }) descriptor`,
      input.functionName,
      "shape",
    );
  }
  return descriptor;
}

export interface RunFunctionBackedActionInput {
  functionName: string;
  functionsDir: string;
  params: unknown;
  ctx: OntologyCtx;
  extensions?: readonly string[];
}

export async function runFunctionBackedAction(
  input: RunFunctionBackedActionInput,
): Promise<unknown> {
  const action = await loadFunctionBackedAction({
    functionName: input.functionName,
    functionsDir: input.functionsDir,
    extensions: input.extensions,
  });

  const parsed = action.schema.safeParse(input.params);
  if (!parsed.success) {
    throw new FunctionBackedActionError(
      `params failed validation for "${input.functionName}": ${formatZodError(parsed.error)}`,
      input.functionName,
      "validate_params",
      parsed.error,
    );
  }

  try {
    return await action.handler({ params: parsed.data, ctx: input.ctx });
  } catch (err) {
    if (err instanceof FunctionBackedActionError) throw err;
    throw new FunctionBackedActionError(
      `handler for "${input.functionName}" threw: ${(err as Error).message}`,
      input.functionName,
      "handler",
      err,
    );
  }
}

function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => `/${i.path.map(String).join("/")}: ${i.message}`)
    .join("; ");
}
