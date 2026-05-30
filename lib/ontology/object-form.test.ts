import { describe, expect, it } from "vitest";
import type { Ontology } from "./schema";
import {
  deriveFormFields,
  coerceFieldValue,
  buildObjectRow,
  buildObjectPatch,
  type FormField,
} from "./object-form";

const ontology = {
  object_types: {
    Guest: {
      properties: {
        id: { type: "uuid", primary_key: true },
        full_name: { type: "string" },
        email: { ref: "email" },
        nights: { type: "integer", required: false },
        status: { type: "enum", values: ["booked", "checked_in"], default: "booked" },
        arrived_at: { type: "date", default: "@today" },
        member_id: { type: "uuid", required: false },
      },
    },
  },
  properties: { email: { type: "email" } },
  link_types: {},
  action_types: {},
} as unknown as Ontology;

describe("deriveFormFields", () => {
  it("skips the primary key and derives kind/required/options from the ontology", () => {
    const fields = deriveFormFields(ontology, "Guest");
    const byName = Object.fromEntries(fields.map((f) => [f.name, f]));
    expect(fields.map((f) => f.name).sort()).toEqual(
      ["arrived_at", "email", "full_name", "member_id", "nights", "status"].sort(),
    );
    expect(byName.id).toBeUndefined(); // pk skipped
    expect(byName.full_name.required).toBe(true); // no required:false, no default
    expect(byName.email.kind).toBe("email"); // resolved through the ref
    expect(byName.nights.required).toBe(false);
    expect(byName.status.kind).toBe("enum");
    expect(byName.status.enumValues).toEqual(["booked", "checked_in"]);
    expect(byName.status.required).toBe(false); // has a default
    expect(byName.arrived_at.required).toBe(false); // has @today default
  });
});

describe("coerceFieldValue", () => {
  const f = (kind: FormField["kind"], extra: Partial<FormField> = {}): FormField => ({
    name: "x",
    kind,
    required: false,
    ...extra,
  });
  it("coerces by kind and rejects malformed input", () => {
    expect(coerceFieldValue(f("integer"), "5")).toEqual({ ok: true, value: 5 });
    expect(coerceFieldValue(f("integer"), "x").ok).toBe(false);
    expect(coerceFieldValue(f("decimal"), "3.5")).toEqual({ ok: true, value: 3.5 });
    expect(coerceFieldValue(f("boolean"), "on")).toEqual({ ok: true, value: true });
    expect(coerceFieldValue(f("boolean"), "")).toEqual({ ok: true, value: false });
    expect(coerceFieldValue(f("enum", { enumValues: ["a", "b"] }), "a")).toEqual({ ok: true, value: "a" });
    expect(coerceFieldValue(f("enum", { enumValues: ["a", "b"] }), "z").ok).toBe(false);
    expect(coerceFieldValue(f("email"), "a@b.com")).toEqual({ ok: true, value: "a@b.com" });
    expect(coerceFieldValue(f("email"), "nope").ok).toBe(false);
    expect(coerceFieldValue(f("date"), "2026-06-01")).toEqual({ ok: true, value: "2026-06-01" });
    expect(coerceFieldValue(f("date"), "june").ok).toBe(false);
    expect(coerceFieldValue(f("string"), " hi ")).toEqual({ ok: true, value: "hi" });
  });
});

describe("buildObjectRow", () => {
  it("assembles id + provided values + resolved defaults, skipping optional blanks", () => {
    const r = buildObjectRow(ontology, "Guest", { full_name: "Lena", email: "lena@x.com" }, { id: "fixed-id" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.id).toBe("fixed-id");
    expect(r.row.full_name).toBe("Lena");
    expect(r.row.email).toBe("lena@x.com");
    expect(r.row.status).toBe("booked"); // default applied
    expect(typeof r.row.arrived_at).toBe("string"); // @today resolved
    expect("nights" in r.row).toBe(false); // optional, no default, not provided
  });

  it("errors when a required field is missing", () => {
    const r = buildObjectRow(ontology, "Guest", { email: "lena@x.com" }, { id: "x" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.includes("full_name"))).toBe(true);
  });

  it("auto-fills an owner field with the actor for member_self ownership", () => {
    const r = buildObjectRow(
      ontology,
      "Guest",
      { full_name: "L", email: "l@x.com" },
      { id: "x", ownerUserId: "u-1" },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.member_id).toBe("u-1");
  });

  it("rejects a malformed enum value", () => {
    const r = buildObjectRow(ontology, "Guest", { full_name: "L", email: "l@x.com", status: "nope" }, { id: "x" });
    expect(r.ok).toBe(false);
  });
});

describe("buildObjectPatch", () => {
  it("coerces only provided fields, no id, no defaults, no required check", () => {
    const r = buildObjectPatch(ontology, "Guest", { status: "checked_in" });
    expect(r).toEqual({ ok: true, row: { status: "checked_in" } });
  });
  it("propagates coercion errors", () => {
    const r = buildObjectPatch(ontology, "Guest", { nights: "lots" });
    expect(r.ok).toBe(false);
  });
});
