import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadOntology } from "../ontology/load";
import { getRuntimeOntologyDir } from "../setup/paths";
import { deriveVocabulary } from "../widgets/vocabulary";
import { resolveTargetTable } from "./target-table";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED_BOOK_CLUB = path.resolve(HERE, "../../scenarios/book-club/ontology");

describe("resolveTargetTable — ontology-derived, fail-closed", () => {
  it("resolves every type in the loaded (runtime) ontology to a real table", async () => {
    const ontology = await loadOntology(getRuntimeOntologyDir());
    const vocab = deriveVocabulary(ontology);
    expect(vocab.validTypes.length).toBeGreaterThan(0);
    for (const t of vocab.validTypes) {
      expect(resolveTargetTable(ontology, t)).not.toBeNull();
    }
  });

  it("returns null for an unknown token (not in the ontology)", async () => {
    const ontology = await loadOntology(getRuntimeOntologyDir());
    expect(resolveTargetTable(ontology, "definitely_not_a_type")).toBeNull();
  });

  it("returns null for a type valid in the ontology but absent from TABLES (schema drift)", async () => {
    // book-club ontology defines `book`, but the generated TABLES registry
    // (hostel-genned) has no Book table → fail-closed on ontology<->schema drift.
    const ontology = await loadOntology(SEED_BOOK_CLUB);
    expect(resolveTargetTable(ontology, "book")).toBeNull();
  });
});
