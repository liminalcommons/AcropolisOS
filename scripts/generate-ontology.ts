import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadOntology } from "../lib/ontology/load";
import {
  generateOntologyModule,
  generateZodModule,
} from "../lib/codegen/zod";
import { generateMastraToolsModule } from "../lib/codegen/mastra-tools";
import { generateDrizzleModule } from "../lib/codegen/drizzle";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const seedName = process.argv[2] ?? "small-community";
  const pkgRoot = path.resolve(__dirname, "..");
  const seedRoot = path.join(pkgRoot, "seed", seedName, "ontology");
  const ontologyOutDir = path.join(pkgRoot, "lib", "ontology");
  const agentOutDir = path.join(pkgRoot, "lib", "agent");
  const dbOutDir = path.join(pkgRoot, "lib", "db");

  const ontology = await loadOntology(seedRoot);
  await mkdir(ontologyOutDir, { recursive: true });
  await mkdir(agentOutDir, { recursive: true });
  await mkdir(dbOutDir, { recursive: true });

  const typesPath = path.join(ontologyOutDir, "types.generated.ts");
  const combinedPath = path.join(ontologyOutDir, "ontology.generated.ts");
  const toolsPath = path.join(agentOutDir, "tools.generated.ts");
  const drizzlePath = path.join(dbOutDir, "schema.generated.ts");

  await writeFile(typesPath, generateZodModule(ontology), "utf8");
  await writeFile(combinedPath, generateOntologyModule(ontology), "utf8");
  await writeFile(toolsPath, generateMastraToolsModule(ontology), "utf8");
  await writeFile(drizzlePath, generateDrizzleModule(ontology), "utf8");

  process.stdout.write(
    `generated:\n  ${typesPath}\n  ${combinedPath}\n  ${toolsPath}\n  ${drizzlePath}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
