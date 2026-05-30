import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// The app pages that load the live ontology must resolve it through
// getRuntimeOntologyDir() (which honors ACROPOLISOS_ONTOLOGY_DIR), not a
// hardcoded path.join(process.cwd(), "ontology"). S4-T18.
const PAGES = [
  "app/ontology/page.tsx",
  "app/(generated)/[type]/page.tsx",
  "app/(generated)/[type]/[id]/page.tsx",
];

describe("app pages resolve the runtime ontology via getRuntimeOntologyDir", () => {
  for (const rel of PAGES) {
    it(`${rel} uses getRuntimeOntologyDir() and does not hardcode process.cwd()/ontology`, () => {
      const src = readFileSync(path.resolve(__dirname, "..", "..", rel), "utf8");
      expect(src).toMatch(/getRuntimeOntologyDir\(\)/);
      expect(src).not.toMatch(/process\.cwd\(\)\s*,\s*["']ontology["']/);
    });
  }
});
