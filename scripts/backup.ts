// US-037: Steward-facing one-shot backup CLI.
//
//   $ npm run backup [-- <outfile.tgz>]
//
// Writes a tarball containing ontology/, functions/, views/, uploads/,
// a pg_dump of DATABASE_URL, and JSONL exports of audit tables.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runBackup } from "../lib/backup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function defaultOutFile(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:]/g, "-")
    .replace(/\..+$/, "");
  return path.resolve(process.cwd(), `acropolisos-backup-${stamp}.tgz`);
}

async function main(): Promise<void> {
  const pkgRoot = path.resolve(__dirname, "..");
  const argOut = process.argv[2];
  const outFile = argOut
    ? path.resolve(process.cwd(), argOut)
    : defaultOutFile();
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write(
      "ERROR DATABASE_URL is required for backup\n",
    );
    process.exit(2);
  }

  const log = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };

  try {
    const result = await runBackup({ pkgRoot, outFile, databaseUrl, log });
    log(
      `audit_counts ontology_audit=${result.auditCounts.ontology_audit} action_audit=${result.auditCounts.action_audit}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ERROR ${msg}\n`);
    process.exit(1);
  }
}

main();
