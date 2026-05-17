import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractArchive, packArchive } from "./archive";
import { parseAuditJsonl, serializeAuditJsonl } from "./jsonl";
import {
  buildManifest,
  parseManifest,
  type BackupManifest,
} from "./manifest";
import {
  createDefaultPgExec,
  type AuditTableName,
  type PgExec,
} from "./pg-exec";

const SOURCE_DIRS = ["ontology", "functions", "views", "uploads"] as const;
const AUDIT_TABLES: AuditTableName[] = ["ontology_audit", "action_audit"];

export interface BackupOptions {
  pkgRoot: string;
  outFile: string;
  databaseUrl: string;
  pgExec?: PgExec;
  log?: (line: string) => void;
}

export interface BackupResult {
  ok: true;
  outFile: string;
  auditCounts: { ontology_audit: number; action_audit: number };
  manifest: BackupManifest;
}

export interface RestoreOptions {
  pkgRoot: string;
  inFile: string;
  databaseUrl: string;
  pgExec?: PgExec;
  replayAudit?: boolean;
  log?: (line: string) => void;
}

export interface RestoreResult {
  ok: true;
  manifest: BackupManifest;
  replayedAuditCounts: { ontology_audit: number; action_audit: number } | null;
}

export async function runBackup(opts: BackupOptions): Promise<BackupResult> {
  const log = opts.log ?? noop;
  const exec = opts.pgExec ?? createDefaultPgExec();
  const staging = await mkdtemp(path.join(tmpdir(), "aos-backup-stage-"));
  try {
    log(`staging at ${staging}`);

    const pkgMeta = await readPkgMeta(opts.pkgRoot);

    const includedDirs: string[] = [];
    for (const dir of SOURCE_DIRS) {
      const src = path.join(opts.pkgRoot, dir);
      if (await pathExists(src)) {
        await cp(src, path.join(staging, dir), { recursive: true });
        includedDirs.push(dir);
        log(`copied ${dir}/`);
      } else {
        log(`skipped ${dir}/ (missing)`);
      }
    }

    const dbFile = path.join(staging, "db.sql");
    try {
      await exec.dump({ databaseUrl: opts.databaseUrl, outFile: dbFile });
      log("pg_dump complete");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`ERROR pg_dump: ${msg}`);
      throw err;
    }

    await mkdir(path.join(staging, "audit"), { recursive: true });
    const auditCounts = { ontology_audit: 0, action_audit: 0 } as const as {
      ontology_audit: number;
      action_audit: number;
    };
    for (const table of AUDIT_TABLES) {
      const rows = await exec.listAudit({
        databaseUrl: opts.databaseUrl,
        table,
      });
      const jsonl = serializeAuditJsonl(rows);
      await writeFile(path.join(staging, "audit", `${table}.jsonl`), jsonl);
      auditCounts[table] = rows.length;
      log(`audit ${table}: ${rows.length} row(s)`);
    }

    const manifest = buildManifest({
      pkgName: pkgMeta.name,
      pkgVersion: pkgMeta.version,
      sourceDirs: includedDirs,
      auditCounts,
    });
    await writeFile(
      path.join(staging, "manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );

    await packArchive({ srcDir: staging, outFile: opts.outFile });
    log(`OK backup ${opts.outFile}`);
    return { ok: true, outFile: opts.outFile, auditCounts, manifest };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function runRestore(opts: RestoreOptions): Promise<RestoreResult> {
  const log = opts.log ?? noop;
  const exec = opts.pgExec ?? createDefaultPgExec();

  if (!(await pathExists(opts.inFile))) {
    log(`ERROR missing backup file ${opts.inFile}`);
    throw new Error(`backup file not found: ${opts.inFile}`);
  }

  const staging = await mkdtemp(path.join(tmpdir(), "aos-restore-stage-"));
  try {
    log(`extracting to ${staging}`);
    await extractArchive({ inFile: opts.inFile, destDir: staging });

    const manifestRaw = await readFile(
      path.join(staging, "manifest.json"),
      "utf8",
    );
    const manifest = parseManifest(manifestRaw);
    log(
      `manifest ${manifest.pkg.name}@${manifest.pkg.version} created ${manifest.createdAt}`,
    );

    for (const dir of manifest.sourceDirs) {
      const src = path.join(staging, dir);
      const dest = path.join(opts.pkgRoot, dir);
      await rm(dest, { recursive: true, force: true });
      await cp(src, dest, { recursive: true });
      log(`restored ${dir}/`);
    }

    const dbFile = path.join(staging, "db.sql");
    if (await pathExists(dbFile)) {
      await exec.restore({ databaseUrl: opts.databaseUrl, inFile: dbFile });
      log("psql restore complete");
    } else {
      log("db.sql missing — skipped psql restore");
    }

    let replayed: { ontology_audit: number; action_audit: number } | null = null;
    if (opts.replayAudit) {
      replayed = { ontology_audit: 0, action_audit: 0 };
      for (const table of AUDIT_TABLES) {
        const jsonlPath = path.join(staging, "audit", `${table}.jsonl`);
        if (!(await pathExists(jsonlPath))) continue;
        const rows = parseAuditJsonl(await readFile(jsonlPath, "utf8"));
        const inserted = await exec.insertAuditRows({
          databaseUrl: opts.databaseUrl,
          table,
          rows,
        });
        replayed[table] = inserted;
        log(`replayed ${table}: ${inserted} row(s)`);
      }
    }

    log(`OK restore ${opts.inFile}`);
    return { ok: true, manifest, replayedAuditCounts: replayed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`ERROR restore: ${msg}`);
    throw err;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

function noop(): void {}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function readPkgMeta(
  pkgRoot: string,
): Promise<{ name: string; version: string }> {
  const raw = await readFile(path.join(pkgRoot, "package.json"), "utf8");
  const j = JSON.parse(raw) as { name?: string; version?: string };
  return { name: j.name ?? "unknown", version: j.version ?? "0.0.0" };
}
