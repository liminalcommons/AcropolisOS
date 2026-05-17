import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuditRow } from "../audit/writer";
import type { PgExec } from "./pg-exec";
import { runBackup, runRestore } from "./index";

let workdir = "";
let pkgRoot = "";
let exec: PgExec;
let dumpedSql: string;
let auditRows: { ontology_audit: AuditRow[]; action_audit: AuditRow[] };

beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "aos-backup-"));
  pkgRoot = path.join(workdir, "pkg");
  await mkdir(path.join(pkgRoot, "ontology"), { recursive: true });
  await mkdir(path.join(pkgRoot, "functions"), { recursive: true });
  await mkdir(path.join(pkgRoot, "uploads"), { recursive: true });
  await writeFile(
    path.join(pkgRoot, "ontology", "thread.yaml"),
    "kind: object_type\nname: Thread\n",
  );
  await writeFile(
    path.join(pkgRoot, "functions", "ping.ts"),
    "export const ping = () => 'pong';\n",
  );
  await writeFile(path.join(pkgRoot, "uploads", "a.txt"), "hello\n");
  // intentionally no views/ dir — backup must tolerate missing optional dirs
  await writeFile(
    path.join(pkgRoot, "package.json"),
    JSON.stringify({ name: "@chora/acropolisos", version: "0.0.1" }),
  );

  dumpedSql = "-- mock pg_dump output\nCREATE TABLE foo (id int);\n";
  auditRows = {
    ontology_audit: [
      {
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        at: new Date("2026-05-17T00:00:00.000Z"),
        actor: "u",
        actor_role: "steward",
        via: "proposal",
        subject_type: "object_type",
        subject_id: "Thread",
        before: null,
        after: { description: "new" },
        metadata: {},
      },
    ],
    action_audit: [],
  };

  exec = {
    dump: vi.fn(async ({ outFile }) => {
      await writeFile(outFile, dumpedSql);
    }),
    restore: vi.fn(async () => {}),
    listAudit: vi.fn(async ({ table }: { table: keyof typeof auditRows }) => auditRows[table]),
    insertAuditRows: vi.fn(async () => 0),
  };
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe("runBackup", () => {
  it("produces a tarball with manifest, source dirs, db.sql, and audit jsonl", async () => {
    const outFile = path.join(workdir, "out.tgz");
    const log = vi.fn();
    const result = await runBackup({
      pkgRoot,
      outFile,
      databaseUrl: "postgres://fake",
      pgExec: exec,
      log,
    });

    expect(result.ok).toBe(true);
    expect(result.outFile).toBe(outFile);
    expect(result.auditCounts).toEqual({ ontology_audit: 1, action_audit: 0 });
    expect(exec.dump).toHaveBeenCalledTimes(1);
    expect(exec.listAudit).toHaveBeenCalledWith({
      databaseUrl: "postgres://fake",
      table: "ontology_audit",
    });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^OK\b/));

    const { extractArchive } = await import("./archive");
    const verifyDir = path.join(workdir, "verify");
    await mkdir(verifyDir, { recursive: true });
    await extractArchive({ inFile: outFile, destDir: verifyDir });

    const manifest = JSON.parse(
      await readFile(path.join(verifyDir, "manifest.json"), "utf8"),
    );
    expect(manifest.version).toBeDefined();
    expect(manifest.auditCounts).toEqual({
      ontology_audit: 1,
      action_audit: 0,
    });

    expect(
      await readFile(path.join(verifyDir, "ontology", "thread.yaml"), "utf8"),
    ).toContain("Thread");
    expect(
      await readFile(path.join(verifyDir, "functions", "ping.ts"), "utf8"),
    ).toContain("pong");
    expect(
      await readFile(path.join(verifyDir, "uploads", "a.txt"), "utf8"),
    ).toBe("hello\n");
    expect(await readFile(path.join(verifyDir, "db.sql"), "utf8")).toBe(
      dumpedSql,
    );
    const auditFile = await readFile(
      path.join(verifyDir, "audit", "ontology_audit.jsonl"),
      "utf8",
    );
    expect(auditFile.trim().split("\n")).toHaveLength(1);
    const actionAudit = await readFile(
      path.join(verifyDir, "audit", "action_audit.jsonl"),
      "utf8",
    );
    expect(actionAudit).toBe("");
  });

  it("emits structured error and rejects when pg_dump fails", async () => {
    const log = vi.fn();
    exec.dump = vi.fn(async () => {
      throw new Error("pg_dump exit 1");
    });
    const outFile = path.join(workdir, "out.tgz");
    await expect(
      runBackup({
        pkgRoot,
        outFile,
        databaseUrl: "postgres://fake",
        pgExec: exec,
        log,
      }),
    ).rejects.toThrow(/pg_dump/);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(/^ERROR\b.*pg_dump/),
    );
  });
});

describe("runRestore", () => {
  it("extracts files into pkgRoot and calls pgExec.restore", async () => {
    const backupFile = path.join(workdir, "out.tgz");
    await runBackup({
      pkgRoot,
      outFile: backupFile,
      databaseUrl: "postgres://fake",
      pgExec: exec,
    });

    // Wipe pkgRoot to simulate disaster
    await rm(path.join(pkgRoot, "ontology"), { recursive: true, force: true });
    await rm(path.join(pkgRoot, "functions"), { recursive: true, force: true });
    await rm(path.join(pkgRoot, "uploads"), { recursive: true, force: true });

    const log = vi.fn();
    const result = await runRestore({
      pkgRoot,
      inFile: backupFile,
      databaseUrl: "postgres://fake",
      pgExec: exec,
      log,
    });

    expect(result.ok).toBe(true);
    expect(exec.restore).toHaveBeenCalledTimes(1);
    expect(exec.insertAuditRows).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^OK\b/));

    expect(
      await readFile(path.join(pkgRoot, "ontology", "thread.yaml"), "utf8"),
    ).toContain("Thread");
    expect(
      await readFile(path.join(pkgRoot, "functions", "ping.ts"), "utf8"),
    ).toContain("pong");
    expect(
      await readFile(path.join(pkgRoot, "uploads", "a.txt"), "utf8"),
    ).toBe("hello\n");
  });

  it("replays audit rows when replayAudit is true", async () => {
    const backupFile = path.join(workdir, "out.tgz");
    await runBackup({
      pkgRoot,
      outFile: backupFile,
      databaseUrl: "postgres://fake",
      pgExec: exec,
    });

    const result = await runRestore({
      pkgRoot,
      inFile: backupFile,
      databaseUrl: "postgres://fake",
      pgExec: exec,
      replayAudit: true,
    });

    expect(result.ok).toBe(true);
    expect(exec.insertAuditRows).toHaveBeenCalledWith(
      expect.objectContaining({
        table: "ontology_audit",
        rows: expect.arrayContaining([
          expect.objectContaining({ subject_id: "Thread" }),
        ]),
      }),
    );
  });

  it("emits structured error on missing input file", async () => {
    const log = vi.fn();
    await expect(
      runRestore({
        pkgRoot,
        inFile: path.join(workdir, "nope.tgz"),
        databaseUrl: "postgres://fake",
        pgExec: exec,
        log,
      }),
    ).rejects.toThrow();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^ERROR\b/));
  });
});
