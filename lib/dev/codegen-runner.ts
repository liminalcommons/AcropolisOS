// US-022: In-process codegen runner.
//
// Wraps scripts/generate-ontology.ts so the dev watcher (and tests) can drive
// codegen without spawning npm — saves the ~600ms node-startup tax every
// time member.yaml is edited. The CLI script also delegates here so there
// is exactly one source of truth for what "ontology codegen" means.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadOntology } from "../ontology/load";
import { generateOntologyModule, generateZodModule } from "../codegen/zod";
import { generateMastraToolsModule } from "../codegen/mastra-tools";
import { generateDrizzleModule } from "../codegen/drizzle";
import { generateInngestActionsModule } from "../codegen/inngest";

export interface RunOntologyCodegenOptions {
  pkgRoot: string;
  seedName?: string;
}

export interface OntologyCodegenResult {
  wrote: string[];
  durationMs: number;
}

export async function runOntologyCodegen(
  options: RunOntologyCodegenOptions,
): Promise<OntologyCodegenResult> {
  const start = Date.now();
  const { pkgRoot, seedName = "small-community" } = options;
  const seedRoot = path.join(pkgRoot, "seed", seedName, "ontology");
  const ontologyOutDir = path.join(pkgRoot, "lib", "ontology");
  const agentOutDir = path.join(pkgRoot, "lib", "agent");
  const dbOutDir = path.join(pkgRoot, "lib", "db");
  const inngestOutDir = path.join(pkgRoot, "lib", "inngest");

  const ontology = await loadOntology(seedRoot);
  await Promise.all([
    mkdir(ontologyOutDir, { recursive: true }),
    mkdir(agentOutDir, { recursive: true }),
    mkdir(dbOutDir, { recursive: true }),
    mkdir(inngestOutDir, { recursive: true }),
  ]);

  const typesPath = path.join(ontologyOutDir, "types.generated.ts");
  const combinedPath = path.join(ontologyOutDir, "ontology.generated.ts");
  const toolsPath = path.join(agentOutDir, "tools.generated.ts");
  const drizzlePath = path.join(dbOutDir, "schema.generated.ts");
  const inngestPath = path.join(
    inngestOutDir,
    "declarative-actions.generated.ts",
  );

  await Promise.all([
    writeFile(typesPath, generateZodModule(ontology), "utf8"),
    writeFile(combinedPath, generateOntologyModule(ontology), "utf8"),
    writeFile(toolsPath, generateMastraToolsModule(ontology), "utf8"),
    writeFile(drizzlePath, generateDrizzleModule(ontology), "utf8"),
    writeFile(inngestPath, generateInngestActionsModule(ontology), "utf8"),
  ]);

  return {
    wrote: [typesPath, combinedPath, toolsPath, drizzlePath, inngestPath],
    durationMs: Date.now() - start,
  };
}
