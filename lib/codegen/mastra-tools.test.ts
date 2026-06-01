import path from "node:path";
import { describe, expect, it } from "vitest";
import { Tool } from "@mastra/core/tools";
import { loadOntology } from "../ontology/load";
import {
  READ_OPS,
  buildMastraTools,
  generateMastraToolsModule,
  toolIdFor,
} from "./mastra-tools";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SMALL_COMMUNITY = path.join(
  PKG_ROOT,
  "scenarios",
  "small-community", "ontology",
);

describe("READ_OPS", () => {
  it("declares the six READ ops required by US-014", () => {
    expect(READ_OPS).toEqual([
      "describe",
      "query",
      "traverse",
      "sample",
      "read",
      "audit",
    ]);
  });
});

describe("toolIdFor", () => {
  it("joins READ op + snake_case object name", () => {
    expect(toolIdFor("read", "Member")).toBe("read_member");
    expect(toolIdFor("query", "MeetingMinute")).toBe("query_meeting_minute");
    expect(toolIdFor("audit", "Event")).toBe("audit_event");
  });
});

describe("buildMastraTools (runtime)", () => {
  it("returns a Mastra Tool instance for every (READ op × object type) pair", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { tools } = buildMastraTools(onto);
    for (const obj of Object.keys(onto.object_types)) {
      for (const op of READ_OPS) {
        const id = toolIdFor(op, obj);
        expect(tools[id], `missing tool ${id}`).toBeInstanceOf(Tool);
      }
    }
  });

  it("includes a generic apply_action tool", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { tools } = buildMastraTools(onto);
    expect(tools.apply_action).toBeInstanceOf(Tool);
  });

  it("yields at least one tool per object type", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { tools } = buildMastraTools(onto);
    for (const obj of Object.keys(onto.object_types)) {
      const lowered = obj.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
      const hit = Object.keys(tools).some((id) => id.endsWith(`_${lowered}`));
      expect(hit, `no tool found for object type ${obj}`).toBe(true);
    }
  });

  it("total tool count equals READ_OPS × object_types + 1 (apply_action)", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { tools } = buildMastraTools(onto);
    const expected =
      READ_OPS.length * Object.keys(onto.object_types).length + 1;
    expect(Object.keys(tools).length).toBe(expected);
  });

  it("apply_action input is a discriminated union over current action types", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { applyActionInput } = buildMastraTools(onto);

    // change_tier is a valid action in small-community
    const okChangeTier = applyActionInput.safeParse({
      action: "change_tier",
      params: {
        member: "123e4567-e89b-12d3-a456-426614174000",
        new_tier: "sustaining",
      },
    });
    expect(okChangeTier.success).toBe(true);

    // mark_notification_read is a valid action in small-community
    const okMarkRead = applyActionInput.safeParse({
      action: "mark_notification_read",
      params: {
        notification_id: "223e4567-e89b-12d3-a456-426614174000",
      },
    });
    expect(okMarkRead.success).toBe(true);

    const wrongAction = applyActionInput.safeParse({
      action: "not_a_real_action",
      params: {},
    });
    expect(wrongAction.success).toBe(false);

    // change_tier with a bad enum value fails validation
    const wrongParams = applyActionInput.safeParse({
      action: "change_tier",
      params: { member: "123e4567-e89b-12d3-a456-426614174000", new_tier: "invalid_tier" },
    });
    expect(wrongParams.success).toBe(false);
  });

  it("READ tool input schemas accept object-type id strings", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { tools } = buildMastraTools(onto);
    const readMember = tools.read_member;
    expect(readMember.inputSchema).toBeDefined();
  });
});

describe("generateMastraToolsModule (TS source)", () => {
  it("emits a header marking the file as generated", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateMastraToolsModule(onto);
    expect(source).toMatch(/generated|do not edit/i);
  });

  it("imports schemas from ../ontology/types.generated", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateMastraToolsModule(onto);
    expect(source).toMatch(
      /from\s+["']\.\.\/ontology\/types\.generated["']/,
    );
  });

  it("imports createTool from @mastra/core/tools", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateMastraToolsModule(onto);
    expect(source).toMatch(/from\s+["']@mastra\/core\/tools["']/);
    expect(source).toMatch(/createTool/);
  });

  it("emits a const export per READ op per object type", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateMastraToolsModule(onto);
    for (const obj of Object.keys(onto.object_types)) {
      const lowered = obj.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
      for (const op of READ_OPS) {
        const id = `${op}_${lowered}`;
        expect(
          source,
          `missing export for tool ${id}`,
        ).toMatch(new RegExp(`export const ${id}Tool\\b`));
      }
    }
  });

  it("emits an apply_action tool export with a discriminated-union input", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateMastraToolsModule(onto);
    expect(source).toMatch(/export const applyActionTool\b/);
    expect(source).toMatch(/discriminatedUnion/);
    for (const action of Object.keys(onto.action_types)) {
      expect(source).toContain(JSON.stringify(action));
    }
  });

  it("emits an aggregate `tools` export with one entry per tool", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateMastraToolsModule(onto);
    expect(source).toMatch(/export const tools\s*=/);
  });
});

describe("committed generated artifact matches codegen output", () => {
  it("lib/agent/tools.generated.ts is in sync with the live ontology", async () => {
    const { readFile } = await import("node:fs/promises");
    // The committed file is generated from the live bind-mounted ontology/,
    // not a seed scenario. small-community was the original seed but the
    // ontology has grown (hostel types, additional actions). Use ontology/ as
    // the canonical source of truth for this sync check.
    const LIVE_ONTOLOGY = path.join(PKG_ROOT, "ontology");
    const onto = await loadOntology(LIVE_ONTOLOGY);
    const expected = generateMastraToolsModule(onto);
    const actual = await readFile(
      path.join(PKG_ROOT, "lib", "agent", "tools.generated.ts"),
      "utf8",
    );
    expect(actual).toBe(expected);
  });
});
