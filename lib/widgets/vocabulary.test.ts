// lib/widgets/vocabulary.test.ts
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOntology } from "@/lib/ontology/load";
import type { Ontology } from "@/lib/ontology/schema";
import { deriveVocabulary } from "@/lib/widgets/vocabulary";

describe("deriveVocabulary — shipped (hostel) ontology", () => {
  let onto: Ontology;
  beforeAll(async () => { onto = await loadOntology(path.resolve(__dirname, "../../ontology")); });

  it("derives snake-case valid types from the ontology object types", () => {
    const v = deriveVocabulary(onto);
    expect(v.validTypes).toContain("guest");
    expect(v.validTypes).toContain("work_trade_agreement");
    expect(v.validTypes).toContain("agent_blocker");
    // exactly one token per object type
    expect(v.validTypes.length).toBe(Object.keys(onto.object_types).length);
  });

  it("maps each token back to its EXACT ontology object-type key (inversion, not guessing)", () => {
    const v = deriveVocabulary(onto);
    for (const token of v.validTypes) {
      const objType = v.typeToObjectType[token];
      expect(onto.object_types[objType]).toBeDefined();
    }
  });

  it("derives field whitelists from each type's properties", () => {
    const v = deriveVocabulary(onto);
    expect(v.validFields["guest"]).toContain("full_name");
    expect(v.validFields["guest"]).toContain("country");
  });
});

describe("deriveVocabulary — NON-hostel ontology (the litmus)", () => {
  let onto: Ontology;
  beforeAll(async () => { onto = await loadOntology(path.resolve(__dirname, "../../seed/book-club")); });

  it("accepts a completely different org's types with zero hostel leakage", () => {
    const v = deriveVocabulary(onto);
    expect(v.validTypes).toContain("book");        // book-club type
    expect(v.validTypes).toContain("reading_meeting");
    expect(v.validTypes).not.toContain("bed");      // hostel must NOT leak
    expect(v.validTypes).not.toContain("booking");
    expect(v.typeToObjectType["book"]).toBe("Book");
    expect(v.validFields["book"]).toContain("title");
  });
});
