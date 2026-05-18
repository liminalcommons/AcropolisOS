// Regenerates the codegen artifacts (schema.generated.ts, types.generated.ts,
// ontology.generated.ts, tools.generated.ts) from the LIVE bind-mounted
// `ontology/` directory. Distinct from `generate-ontology.ts` which reads from
// `seed/<name>/ontology/` for first-install seeding.
//
// Why this exists at boot: applyProposal regenerates these files from inside
// the Next.js process, but the container's generated files are baked into the
// image layer at build time. After a `docker compose restart`, those changes
// are gone and `drizzle-kit push --force` (in the entrypoint) reverts the live
// DB schema to the stale baked version — silently dropping any column added
// by a successful apply. Running this script at boot makes the bind-mounted
// `ontology/` the single source of truth before drizzle-kit syncs the DB.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GeneratedFilesCodegen } from "../lib/proposals/adapters/codegen";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const pkgRoot = path.resolve(__dirname, "..");
  const ontologyRoot = path.join(pkgRoot, "ontology");
  const codegen = new GeneratedFilesCodegen({ packageRoot: pkgRoot });
  const snapshot = await codegen.regenerate(ontologyRoot);
  const paths = snapshot.files.map((f) => f.path).join("\n  ");
  process.stdout.write(`regenerated from ${ontologyRoot}:\n  ${paths}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
