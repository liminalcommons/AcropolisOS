// US-037: Steward-facing one-shot restore CLI.
//
//   $ npm run restore -- <infile.tgz> [--replay-audit]
//
// Extracts files into pkgRoot, replays pg_dump via psql, and (optionally)
// replays audit JSONL exports back into ontology_audit / action_audit.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRestore } from "../lib/backup";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ParsedArgs {
  inFile: string | null;
  replayAudit: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { inFile: null, replayAudit: false };
  for (const a of argv) {
    if (a === "--replay-audit") {
      out.replayAudit = true;
    } else if (!out.inFile && !a.startsWith("--")) {
      out.inFile = a;
    }
  }
  return out;
}

async function main(): Promise<void> {
  const pkgRoot = path.resolve(__dirname, "..");
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.inFile) {
    process.stderr.write(
      "Usage: acropolisos restore <infile.tgz> [--replay-audit]\n",
    );
    process.exit(2);
  }
  const inFile = path.resolve(process.cwd(), parsed.inFile);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write("ERROR DATABASE_URL is required for restore\n");
    process.exit(2);
  }

  const log = (line: string): void => {
    process.stdout.write(`${line}\n`);
  };

  try {
    const result = await runRestore({
      pkgRoot,
      inFile,
      databaseUrl,
      replayAudit: parsed.replayAudit,
      log,
    });
    if (result.replayedAuditCounts) {
      log(
        `replayed ontology_audit=${result.replayedAuditCounts.ontology_audit} action_audit=${result.replayedAuditCounts.action_audit}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ERROR ${msg}\n`);
    process.exit(1);
  }
}

main();
