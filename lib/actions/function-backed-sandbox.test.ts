// Verifies the ESLint sandbox rule for function-backed actions (US-025):
// imports of raw DB / fs / process / net / auth modules inside functions/**
// must be flagged.

import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const SANDBOX_FIXTURE_DIR = path.join(PACKAGE_ROOT, "functions", "__sandbox_fixtures__");

beforeAll(() => {
  mkdirSync(SANDBOX_FIXTURE_DIR, { recursive: true });
});

afterAll(() => {
  rmSync(SANDBOX_FIXTURE_DIR, { recursive: true, force: true });
});

async function lint(source: string, basename: string): Promise<ESLint.LintResult[]> {
  const filePath = path.join(SANDBOX_FIXTURE_DIR, `${basename}.ts`);
  writeFileSync(filePath, source, "utf8");
  const eslint = new ESLint({ cwd: PACKAGE_ROOT });
  return eslint.lintFiles([filePath]);
}

function violations(results: ESLint.LintResult[]): string[] {
  return results.flatMap((r) =>
    r.messages.filter((m) => m.ruleId === "no-restricted-imports").map((m) => m.message),
  );
}

describe("function-backed sandbox — eslint rule", () => {
  it("flags child_process imports", async () => {
    const out = await lint(
      `import { exec } from "child_process";\nexport default exec;\n`,
      "uses-child-process",
    );
    expect(violations(out).length).toBeGreaterThan(0);
  });

  it("flags fs and node:fs imports", async () => {
    const out = await lint(
      `import { readFileSync } from "node:fs";\nexport default readFileSync;\n`,
      "uses-fs",
    );
    expect(violations(out).length).toBeGreaterThan(0);
  });

  it("flags drizzle-orm imports", async () => {
    const out = await lint(
      `import { sql } from "drizzle-orm";\nexport default sql;\n`,
      "uses-drizzle",
    );
    expect(violations(out).length).toBeGreaterThan(0);
  });

  it("flags inngest client imports", async () => {
    const out = await lint(
      `import { Inngest } from "inngest";\nexport default Inngest;\n`,
      "uses-inngest",
    );
    expect(violations(out).length).toBeGreaterThan(0);
  });

  it("does NOT flag the SDK or zod imports", async () => {
    const out = await lint(
      `import { z } from "zod";\nimport { defineAction } from "@acropolisos/sdk";\nexport default defineAction({ schema: z.object({}), handler: async () => ({ ok: true }) });\n`,
      "uses-sdk",
    );
    expect(violations(out)).toEqual([]);
  });
});
