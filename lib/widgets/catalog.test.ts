// catalog.test.ts — validateWidgetConfig is ONTOLOGY-AWARE.
//
// The membership of config.type and the column/field whitelist are derived from
// the LOADED ontology (deriveVocabulary), not from hostel literals. Proven with a
// NON-hostel ontology (scenarios/book-club/ontology): a `book` over its column `title` is
// accepted; a hostel `bed` is rejected; an unknown column on a valid type is
// rejected. Zero hostel leakage.
//
// Calendar suite proves CalendarConfigSchema uses CatalogTypeSchema (z.string()),
// not the former z.enum(["event","booking"]) — any org's date-bearing type now
// works, not just hostel types.

import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOntology } from "@/lib/ontology/load";
import type { Ontology } from "@/lib/ontology/schema";
import { validateWidgetConfig } from "@/lib/widgets/catalog";

describe("validateWidgetConfig is ontology-aware", () => {
  let book: Ontology;
  beforeAll(async () => {
    book = await loadOntology(path.resolve(__dirname, "../../scenarios/book-club/ontology"));
  });

  it("accepts a data_table over a type that exists in the loaded ontology", () => {
    const r = validateWidgetConfig("data_table", { type: "book", columns: ["title"] }, book);
    expect(r.ok).toBe(true);
  });

  it("rejects a type that is NOT in the loaded ontology (no hostel literals)", () => {
    const r = validateWidgetConfig("data_table", { type: "bed", columns: ["code"] }, book);
    expect(r.ok).toBe(false);
  });

  it("rejects an unknown column on a valid type", () => {
    const r = validateWidgetConfig("data_table", { type: "book", columns: ["nope"] }, book);
    expect(r.ok).toBe(false);
  });
});

// ── Calendar: CalendarConfigSchema must use CatalogTypeSchema (z.string()) ──────
//
// REGRESSION SENTINEL: before the fix, CalendarConfigSchema used
// z.enum(["event","booking"]) which rejected any org lacking those literal types.
// After the fix it uses CatalogTypeSchema (z.string()); type-membership is
// enforced at runtime via deriveVocabulary(ontology).validTypes — same as
// metric/data_table/roster. The date_field is additionally validated against the
// type's field whitelist inside validateWidgetConfig.

describe("validateWidgetConfig — calendar kind is ontology-derived (not hostel enum)", () => {
  let bookClubOntology: Ontology;
  let hostelOntology: Ontology;

  beforeAll(async () => {
    bookClubOntology = await loadOntology(path.resolve(__dirname, "../../scenarios/book-club/ontology"));
    hostelOntology = await loadOntology(path.resolve(__dirname, "../../scenarios/hostel/ontology"));
  });

  // REGRESSION SENTINEL: non-hostel type with a real date field must now be accepted.
  // Before fix: z.enum(["event","booking"]) → "invalid_enum_value" → ok:false.
  // After fix: z.string() → type-membership check → date_field whitelist check.
  it("accepts a non-hostel calendar type (reading_meeting / date) — regression sentinel", () => {
    const r = validateWidgetConfig(
      "calendar",
      { type: "reading_meeting", date_field: "date" },
      bookClubOntology,
    );
    expect(r.ok).toBe(true);
  });

  // date_field not in the ontology-derived field whitelist → rejected.
  it("rejects a calendar config whose date_field is not a real field on the type", () => {
    const r = validateWidgetConfig(
      "calendar",
      { type: "reading_meeting", date_field: "nope" },
      bookClubOntology,
    );
    expect(r.ok).toBe(false);
    expect((r as { ok: false; error: string }).error).toBe("unknown_filter_field");
  });

  // Hostel path must continue to work after the fix.
  // scenarios/hostel/ontology/object-types/event.yaml: starts_at is the date property.
  it("accepts a hostel calendar (event / starts_at) — hostel path still works", () => {
    const r = validateWidgetConfig(
      "calendar",
      { type: "event", date_field: "starts_at" },
      hostelOntology,
    );
    expect(r.ok).toBe(true);
  });
});
