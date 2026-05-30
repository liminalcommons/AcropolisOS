// lib/agent/read-tools-ai-sdk-ops.test.ts
import { describe, expect, it } from "vitest";
import { buildReadToolsAiSdk } from "./read-tools-ai-sdk";
import { loadOntology } from "../ontology/load";
import { createCtx } from "../ontology/ctx";
import { createInMemoryStore } from "../ontology/ctx";
import { buildObjectPermissionsMap } from "../ontology/ctx";
import path from "node:path";

const SMALL = path.resolve(__dirname, "..", "..", "seed", "small-community");

describe("buildReadToolsAiSdk op coverage", () => {
  it("surfaces query/read/describe AND traverse/sample/audit so proposals are evidence-grounded", async () => {
    const ontology = await loadOntology(SMALL);
    const db = createInMemoryStore(Object.keys(ontology.object_types));
    const ctx = createCtx({
      db,
      actor: { userId: "steward", email: "steward@example.com", role: "steward", customRoles: [] },
      permissions: buildObjectPermissionsMap(ontology),
    });
    const tools = buildReadToolsAiSdk({ ontology, ctx });
    const ids = Object.keys(tools);
    expect(ids.some((i) => i.startsWith("query_"))).toBe(true);
    expect(ids.some((i) => i.startsWith("traverse_"))).toBe(true);
    expect(ids.some((i) => i.startsWith("sample_"))).toBe(true);
    expect(ids.some((i) => i.startsWith("audit_"))).toBe(true);
  });
});
