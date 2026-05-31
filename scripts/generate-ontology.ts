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
import { generateInngestActionsModule } from "../lib/codegen/inngest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  // Scenario bundles live at packages/acropolisos/scenarios/<name>/ontology/
  // (action-types, object-types, properties.yaml, roles.yaml). A bare run is
  // REFUSED: it would regenerate lib/*.generated.ts from the small-community
  // seed and CLOBBER the richer live ontology. Boot uses regenerate-from-live.ts
  // (reads ./ontology); the dev watcher uses lib/dev/codegen-runner.ts. Pass a
  // scenario bundle explicitly: `npm run codegen -- <name>`.
  const seedArg = process.argv[2];
  if (!seedArg) {
    process.stderr.write(
      "refusing to run codegen with the implicit default seed.\n" +
        "A bare `npm run codegen` would regenerate lib/*.generated.ts from the\n" +
        "small-community seed and CLOBBER the live ontology. Pass a scenario\n" +
        "bundle explicitly, e.g.:\n" +
        "  npm run codegen -- small-community\n" +
        "  npm run codegen -- hostel\n",
    );
    process.exit(2);
  }
  const seedName = seedArg;
  const pkgRoot = path.resolve(__dirname, "..");
  const seedRoot = path.join(pkgRoot, "scenarios", seedName, "ontology");
  const ontologyOutDir = path.join(pkgRoot, "lib", "ontology");
  const agentOutDir = path.join(pkgRoot, "lib", "agent");
  const dbOutDir = path.join(pkgRoot, "lib", "db");
  const inngestOutDir = path.join(pkgRoot, "lib", "inngest");

  const ontology = await loadOntology(seedRoot);
  await mkdir(ontologyOutDir, { recursive: true });
  await mkdir(agentOutDir, { recursive: true });
  await mkdir(dbOutDir, { recursive: true });
  await mkdir(inngestOutDir, { recursive: true });

  const typesPath = path.join(ontologyOutDir, "types.generated.ts");
  const combinedPath = path.join(ontologyOutDir, "ontology.generated.ts");
  const toolsPath = path.join(agentOutDir, "tools.generated.ts");
  const drizzlePath = path.join(dbOutDir, "schema.generated.ts");
  const inngestPath = path.join(inngestOutDir, "declarative-actions.generated.ts");

  await writeFile(typesPath, generateZodModule(ontology), "utf8");
  await writeFile(combinedPath, generateOntologyModule(ontology), "utf8");
  await writeFile(toolsPath, generateMastraToolsModule(ontology), "utf8");
  await writeFile(drizzlePath, generateDrizzleModule(ontology), "utf8");
  await writeFile(
    inngestPath,
    generateInngestActionsModule(ontology),
    "utf8",
  );

  process.stdout.write(
    `generated:\n  ${typesPath}\n  ${combinedPath}\n  ${toolsPath}\n  ${drizzlePath}\n  ${inngestPath}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
