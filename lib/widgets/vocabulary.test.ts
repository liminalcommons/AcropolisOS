// lib/widgets/vocabulary.test.ts
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadOntology } from "@/lib/ontology/load";
import type { Ontology } from "@/lib/ontology/schema";
import {
  deriveVocabulary,
  deriveKeyFields,
  deriveRequiredRefs,
} from "@/lib/widgets/vocabulary";

const seed = (n: string) =>
  path.resolve(__dirname, "..", "..", "scenarios", n, "ontology");

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
  beforeAll(async () => { onto = await loadOntology(path.resolve(__dirname, "../../scenarios/book-club/ontology")); });

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

describe("deriveKeyFields", () => {
  it("book-club Book → title (not hostel code/full_name)", async () => {
    const o = await loadOntology(seed("book-club"));
    const k = deriveKeyFields(o, "Book");
    expect(k).toContain("title");
    expect(k).not.toContain("code");
    expect(k).not.toContain("full_name");
  });

  it("hostel Guest → email + full_name (email resolved through a property ref)", async () => {
    const o = await loadOntology(seed("hostel"));
    const k = deriveKeyFields(o, "Guest");
    // Guest.email is `{ ref: email }` — its `type: email` lives in the shared
    // registry, so derivation must resolve the reference to find it.
    expect(k.sort()).toEqual(["email", "full_name"]);
  });

  it("unknown type → []", async () => {
    const o = await loadOntology(seed("book-club"));
    expect(deriveKeyFields(o, "DoesNotExist")).toEqual([]);
  });
});

describe("deriveRequiredRefs", () => {
  it("book-club Book has no required refs", async () => {
    expect(deriveRequiredRefs(await loadOntology(seed("book-club")), "Book")).toEqual([]);
  });
  it("hostel Booking requires guest + bed", async () => {
    expect(deriveRequiredRefs(await loadOntology(seed("hostel")), "Booking").sort()).toEqual(["bed", "guest"]);
  });
  it("hostel Shift requires member_id (link-injected NOT NULL FK from the `staffed` link)", async () => {
    // member_id is NOT an inline ref property — it is the FK codegen injects on
    // the `to` side of the one-to-one `staffed` Member→Shift link (.notNull()).
    expect(deriveRequiredRefs(await loadOntology(seed("hostel")), "Shift")).toEqual(["member_id"]);
  });
  it("hostel WorkTradeAgreement requires bed_comp but not guest (guest is required:false → nullable)", async () => {
    expect(deriveRequiredRefs(await loadOntology(seed("hostel")), "WorkTradeAgreement")).toEqual(["bed_comp"]);
  });
  it("unknown type → []", async () => {
    expect(deriveRequiredRefs(await loadOntology(seed("hostel")), "DoesNotExist")).toEqual([]);
  });
});
