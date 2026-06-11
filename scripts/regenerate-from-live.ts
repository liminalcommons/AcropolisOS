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
import { loadOntology } from "../lib/ontology/load";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main(): Promise<void> {
  const pkgRoot = path.resolve(__dirname, "..");
  const ontologyRoot = path.join(pkgRoot, "ontology");

  // FAIL-LOUD GUARD: refuse to regenerate from an ontology with zero object
  // types. Observed on a fresh-clone first boot (Docker Desktop/Windows): the
  // bind-mounted ontology/ read as empty for the first seconds of container
  // life, so this script silently emitted EMPTY generated files — and the
  // entrypoint's `drizzle-kit push` that follows would sync the DB toward an
  // empty schema. An empty dir is never a real runtime ontology (even the
  // empty-instance scenario ships object types); abort and let the entrypoint
  // surface the error instead of nuking the artifacts.
  const ontology = await loadOntology(ontologyRoot);
  const objectTypeCount = Object.keys(ontology.object_types ?? {}).length;
  if (objectTypeCount === 0) {
    throw new Error(
      `regenerate-from-live: ${ontologyRoot} loaded ZERO object types — ` +
        `refusing to overwrite generated files (bind mount not ready, or the ` +
        `ontology/ dir is genuinely empty). Fix the mount and restart.`,
    );
  }

  const codegen = new GeneratedFilesCodegen({ packageRoot: pkgRoot });
  const snapshot = await codegen.regenerate(ontologyRoot);
  const paths = snapshot.files.map((f) => f.path).join("\n  ");
  process.stdout.write(`regenerated from ${ontologyRoot}:\n  ${paths}\n`);
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(1);
});
