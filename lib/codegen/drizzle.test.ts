import { describe, expect, it } from "vitest";
import { generateDrizzleModule } from "@/lib/codegen/drizzle";
import { loadOntology } from "@/lib/ontology/load";
import path from "node:path";

describe("TABLES registry emission", () => {
  it("emits a TABLES const keyed by every object type name", async () => {
    // Use the same seed the codegen pipeline defaults to (seed/small-community).
    // NOTE: generateDrizzleModule is the actual exported name (plan assumed generateDrizzleSchema).
    const ontology = await loadOntology(
      path.resolve(__dirname, "../../seed/small-community"),
    );
    const out = generateDrizzleModule(ontology);
    expect(out).toContain("export const TABLES");
    // Every object type must appear as a PascalCase key in the registry.
    for (const typeName of Object.keys(ontology.object_types)) {
      expect(out).toMatch(new RegExp(`\\b${typeName}\\s*:`));
    }
  });
});
