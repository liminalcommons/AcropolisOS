// catalog.test.ts — validateWidgetConfig is ONTOLOGY-AWARE.
//
// The membership of config.type and the column/field whitelist are derived from
// the LOADED ontology (deriveVocabulary), not from hostel literals. Proven with a
// NON-hostel ontology (seed/book-club): a `book` over its column `title` is
// accepted; a hostel `bed` is rejected; an unknown column on a valid type is
// rejected. Zero hostel leakage.

import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOntology } from "@/lib/ontology/load";
import type { Ontology } from "@/lib/ontology/schema";
import { validateWidgetConfig } from "@/lib/widgets/catalog";

describe("validateWidgetConfig is ontology-aware", () => {
  let book: Ontology;
  beforeAll(async () => {
    book = await loadOntology(path.resolve(__dirname, "../../seed/book-club"));
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
