import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../ctx";
import { createCtx, createInMemoryStore } from "../ontology/ctx";
import type { Member } from "../ontology/types.generated";
import {
  FunctionBackedActionError,
  loadFunctionBackedAction,
  runFunctionBackedAction,
} from "./function-backed";

const steward: Actor = {
  userId: "u-steward",
  email: "s@example.com",
  role: "steward",
  customRoles: [],
};

function memberRow(id: string, overrides: Partial<Member> = {}): Member {
  return {
    id,
    full_name: `Member ${id}`,
    email: `${id}@example.com`,
    joined_at: "2026-01-01",
    tier: "basic",
    notes: "",
    ...overrides,
  };
}

// Vitest runs through Vite, which only resolves modules under the project
// root. Keep fixture files inside the package by writing them under
// `lib/actions/__test_fixtures__/<run-id>/functions/`.
const FIXTURE_ROOT = path.join(__dirname, "__test_fixtures__");

let tmpRoot: string;
let functionsDir: string;

beforeEach(() => {
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  tmpRoot = mkdtempSync(path.join(FIXTURE_ROOT, "run-"));
  functionsDir = path.join(tmpRoot, "functions");
  mkdirSync(functionsDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeFunction(actionName: string, source: string): void {
  writeFileSync(path.join(functionsDir, `${actionName}.ts`), source, "utf8");
}

describe("loadFunctionBackedAction", () => {
  it("loads a defineAction default export from functions/{action_name}.ts", async () => {
    writeFunction(
      "echo",
      `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({ message: z.string() }),
  handler: async ({ params }) => ({ echoed: params.message }),
});
      `.trim(),
    );
    const action = await loadFunctionBackedAction({
      functionName: "echo",
      functionsDir,
    });
    expect(action.__isAcropolisAction).toBe(true);
    expect(typeof action.handler).toBe("function");
  });

  it("throws FunctionBackedActionError when the file is missing", async () => {
    await expect(
      loadFunctionBackedAction({
        functionName: "ghost",
        functionsDir,
      }),
    ).rejects.toBeInstanceOf(FunctionBackedActionError);
  });

  it("throws FunctionBackedActionError when the default export is not a defineAction descriptor", async () => {
    writeFunction("bad", `export default { not: "an action" };`);
    await expect(
      loadFunctionBackedAction({ functionName: "bad", functionsDir }),
    ).rejects.toThrow(/defineAction/);
  });
});

describe("runFunctionBackedAction — seed change_tier function (real file)", () => {
  // AC: "seed change_tier function-backed action runs through pipeline".
  const seedFunctionsDir = path.join(__dirname, "..", "..", "functions");

  it("runs the real functions/change-tier.ts against an in-memory store", async () => {
    const db = createInMemoryStore();
    await db.objects.Member.create(memberRow("m-seed", { tier: "basic" }));
    const ctx = createCtx({ db, actor: steward });

    const result = await runFunctionBackedAction({
      functionName: "change-tier",
      functionsDir: seedFunctionsDir,
      params: { member: "m-seed", new_tier: "sustaining" },
      ctx,
    });

    expect(result).toEqual({
      ok: true,
      member: "m-seed",
      previous_tier: "basic",
      new_tier: "sustaining",
    });
    const after = await ctx.objects.Member.findById("m-seed");
    expect(after?.tier).toBe("sustaining");
  });

  it("returns member_not_found when the target id is missing", async () => {
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    const result = await runFunctionBackedAction({
      functionName: "change-tier",
      functionsDir: seedFunctionsDir,
      params: { member: "ghost", new_tier: "lifetime" },
      ctx,
    });
    expect(result).toEqual({
      ok: false,
      reason: "member_not_found",
      member: "ghost",
    });
  });
});

describe("runFunctionBackedAction — change_tier pipeline (synthetic fixture)", () => {
  it("validates params via schema then mutates Member.tier through ctx.objects", async () => {
    writeFunction(
      "change-tier",
      `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({
    member: z.string(),
    new_tier: z.enum(["basic", "sustaining", "lifetime"]),
  }),
  handler: async ({ params, ctx }) => {
    const updated = await ctx.objects.Member.update(params.member, { tier: params.new_tier });
    if (!updated) return { ok: false, reason: "member_not_found" };
    return { ok: true, member: updated.id, tier: updated.tier };
  },
});
      `.trim(),
    );

    const db = createInMemoryStore();
    await db.objects.Member.create(memberRow("m-1", { tier: "basic" }));
    const ctx = createCtx({ db, actor: steward });

    const result = await runFunctionBackedAction({
      functionName: "change-tier",
      functionsDir,
      params: { member: "m-1", new_tier: "lifetime" },
      ctx,
    });

    expect(result).toEqual({ ok: true, member: "m-1", tier: "lifetime" });
    const after = await ctx.objects.Member.findById("m-1");
    expect(after?.tier).toBe("lifetime");
  });

  it("surfaces a schema validation error before calling the handler", async () => {
    writeFunction(
      "change-tier",
      `
import { z } from "zod";
import { defineAction } from "@acropolisos/sdk";
export default defineAction({
  schema: z.object({
    member: z.string(),
    new_tier: z.enum(["basic", "sustaining", "lifetime"]),
  }),
  handler: async () => { throw new Error("handler should not run"); },
});
      `.trim(),
    );
    const ctx = createCtx({ db: createInMemoryStore(), actor: steward });
    await expect(
      runFunctionBackedAction({
        functionName: "change-tier",
        functionsDir,
        params: { member: "m-1", new_tier: "platinum" },
        ctx,
      }),
    ).rejects.toBeInstanceOf(FunctionBackedActionError);
  });
});
