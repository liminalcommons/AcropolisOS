import { describe, expect, it } from "vitest";
import {
  ActionType,
  InlineProperty,
  LinkType,
  ObjectType,
  PropertyDefinition,
  PRIMITIVE_PROPERTY_TYPES,
} from "./schema";

describe("InlineProperty", () => {
  it("accepts every documented primitive scalar type", () => {
    for (const type of PRIMITIVE_PROPERTY_TYPES) {
      if (type === "enum" || type === "ref") continue;
      expect(InlineProperty.safeParse({ type }).success).toBe(true);
    }
  });

  it("rejects an unknown property type", () => {
    const result = InlineProperty.safeParse({ type: "geo" });
    expect(result.success).toBe(false);
  });

  it("requires `values` on an enum property", () => {
    const result = InlineProperty.safeParse({ type: "enum" });
    expect(result.success).toBe(false);
  });

  it("requires `target` on a ref property", () => {
    const result = InlineProperty.safeParse({ type: "ref" });
    expect(result.success).toBe(false);
  });

  it("parses a ref property to a target", () => {
    const result = InlineProperty.safeParse({ type: "ref", target: "Member" });
    expect(result.success).toBe(true);
  });
});

describe("PropertyDefinition", () => {
  it("accepts a shared-property reference shape", () => {
    expect(PropertyDefinition.safeParse({ ref: "email" }).success).toBe(true);
  });

  it("rejects a ref with empty target name", () => {
    expect(PropertyDefinition.safeParse({ ref: "" }).success).toBe(false);
  });
});

describe("ObjectType", () => {
  const valid = {
    description: "A person",
    title_property: "full_name",
    permissions: { read: ["*"], write: ["steward"] },
    properties: {
      id: { type: "uuid", primary_key: true },
      full_name: { type: "string" },
      email: { ref: "email" },
      tier: { type: "enum", values: ["basic", "sustaining"] },
    },
  };

  it("parses a valid object type from the spec example", () => {
    const result = ObjectType.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("rejects an object type with no properties", () => {
    const result = ObjectType.safeParse({ ...valid, properties: {} });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown top-level key (strict mode)", () => {
    const result = ObjectType.safeParse({ ...valid, color: "red" });
    expect(result.success).toBe(false);
  });

  it("accepts the optional data_audit flag", () => {
    const result = ObjectType.safeParse({ ...valid, data_audit: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data_audit).toBe(true);
    }
  });

  it("defaults data_audit to undefined when omitted", () => {
    const result = ObjectType.parse(valid);
    expect(result.data_audit).toBeUndefined();
  });
});

describe("LinkType", () => {
  it("parses a many-to-many link", () => {
    const result = LinkType.safeParse({
      from: "Member",
      to: "Event",
      cardinality: "many-to-many",
      properties: { attended_at: { type: "timestamp" } },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown cardinality values", () => {
    const result = LinkType.safeParse({
      from: "A",
      to: "B",
      cardinality: "some-to-some",
    });
    expect(result.success).toBe(false);
  });
});

describe("ActionType", () => {
  it("defaults agent_policy to always_confirm", () => {
    const result = ActionType.parse({
      description: "Record attendance",
      creates_link: "attended",
      parameters: { member: { type: "ref", target: "Member", required: true } },
      permissions: ["steward"],
    });
    expect(result.agent_policy).toBe("always_confirm");
  });

  it("accepts auto_apply policy", () => {
    const result = ActionType.safeParse({
      agent_policy: "auto_apply",
      side_effects: ["audit"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid agent_policy value", () => {
    const result = ActionType.safeParse({ agent_policy: "yolo" });
    expect(result.success).toBe(false);
  });
});
