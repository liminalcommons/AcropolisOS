import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadOntology } from "../ontology/load";
import { getRuntimeOntologyDir } from "../setup/paths";
import { deriveVocabulary } from "../widgets/vocabulary";
import { isValidTargetType, resolveTargetTable } from "./target-table";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED_BOOK_CLUB = path.resolve(HERE, "../../seed/book-club");

describe("isValidTargetType — de-contamination litmus (no TABLES, no DB)", () => {
  it("accepts a type in the loaded ontology and rejects a hostel literal", async () => {
    const ontology = await loadOntology(SEED_BOOK_CLUB);
    expect(isValidTargetType(ontology, "book")).toBe(true);
    expect(isValidTargetType(ontology, "bed")).toBe(false); // hostel leakage gone
  });
});

describe("resolveTargetTable — dynamic + fail-closed against the runtime ontology", () => {
  it("resolves every type in the loaded ontology to a real table", async () => {
    const ontology = await loadOntology(getRuntimeOntologyDir());
    const vocab = deriveVocabulary(ontology);
    expect(vocab.validTypes.length).toBeGreaterThan(0);
    for (const t of vocab.validTypes) {
      expect(resolveTargetTable(ontology, t)).not.toBeNull();
    }
  });
  it("returns null for a type absent from the loaded ontology", async () => {
    const ontology = await loadOntology(getRuntimeOntologyDir());
    expect(resolveTargetTable(ontology, "definitely_not_a_type")).toBeNull();
  });
});
