// US-037 smoke test: backup -> drop DB + ontology -> restore -> identical rows.
//
// Uses a fake PgExec that simulates pg_dump as a string snapshot of the DB
// state and pg_restore as overwriting that state. This keeps the round-trip
// guarantee verifiable in CI without requiring a live Postgres.

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditRow } from "../audit/writer";
import { runBackup, runRestore } from "./index";
import type { AuditTableName, PgExec } from "./pg-exec";

interface FakeDb {
  members: Array<{ id: string; name: string }>;
  ontology_audit: AuditRow[];
  action_audit: AuditRow[];
}

let workdir = "";
let pkgRoot = "";
let db: FakeDb;
let exec: PgExec;

function snapshot(d: FakeDb): string {
  return JSON.stringify(
    {
      members: d.members,
      ontology_audit: d.ontology_audit.map((r) => ({
        ...r,
        at: r.at.toISOString(),
      })),
      action_audit: d.action_audit.map((r) => ({
        ...r,
        at: r.at.toISOString(),
      })),
    },
    null,
    2,
  );
}

function loadSnapshot(d: FakeDb, raw: string): void {
  const parsed = JSON.parse(raw) as {
    members: Array<{ id: string; name: string }>;
    ontology_audit: Array<AuditRow & { at: string }>;
    action_audit: Array<AuditRow & { at: string }>;
  };
  d.members = parsed.members;
  d.ontology_audit = parsed.ontology_audit.map((r) => ({
    ...r,
    at: new Date(r.at),
  }));
  d.action_audit = parsed.action_audit.map((r) => ({
    ...r,
    at: new Date(r.at),
  }));
}

beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "aos-smoke-"));
  pkgRoot = path.join(workdir, "pkg");
  await mkdir(path.join(pkgRoot, "ontology"), { recursive: true });
  await writeFile(
    path.join(pkgRoot, "ontology", "thread.yaml"),
    "kind: object_type\nname: Thread\n",
  );
  await writeFile(
    path.join(pkgRoot, "package.json"),
    JSON.stringify({ name: "@chora/acropolisos", version: "0.0.1" }),
  );

  db = {
    members: [
      { id: "m-1", name: "Alice" },
      { id: "m-2", name: "Bob" },
    ],
    ontology_audit: [
      {
        id: "11111111-1111-1111-1111-111111111111",
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
    action_audit: [
      {
        id: "22222222-2222-2222-2222-222222222222",
        at: new Date("2026-05-17T01:00:00.000Z"),
        actor: "u",
        actor_role: "member",
        via: "inngest",
        subject_type: "action",
        subject_id: "add-member",
        before: null,
        after: { member_id: "m-2" },
        metadata: { run_id: "run-9" },
      },
    ],
  };

  exec = {
    async dump({ outFile }) {
      await writeFile(outFile, snapshot(db));
    },
    async restore({ inFile }) {
      const raw = await readFile(inFile, "utf8");
      loadSnapshot(db, raw);
    },
    async listAudit({ table }: { table: AuditTableName }) {
      return db[table].map((r) => ({ ...r }));
    },
    async insertAuditRows({ table, rows }) {
      const existing = new Set(db[table].map((r) => r.id));
      let inserted = 0;
      for (const r of rows) {
        if (existing.has(r.id)) continue;
        db[table].push({ ...r });
        inserted += 1;
      }
      return inserted;
    },
  };
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe("US-037 smoke: backup -> wipe -> restore -> identical rows", () => {
  it("preserves /audit and /member rows across the round trip", async () => {
    const backupFile = path.join(workdir, "backup.tgz");
    const initialMembers = JSON.parse(JSON.stringify(db.members));
    const initialOntologyAudit = db.ontology_audit.map((r) => r.id).sort();
    const initialActionAudit = db.action_audit.map((r) => r.id).sort();

    const backupRes = await runBackup({
      pkgRoot,
      outFile: backupFile,
      databaseUrl: "postgres://fake",
      pgExec: exec,
    });
    expect(backupRes.ok).toBe(true);
    expect(backupRes.auditCounts).toEqual({
      ontology_audit: 1,
      action_audit: 1,
    });

    // Simulate disaster: drop DB rows + ontology files
    db.members = [];
    db.ontology_audit = [];
    db.action_audit = [];
    await rm(path.join(pkgRoot, "ontology"), { recursive: true, force: true });

    // Verify damage
    expect(db.members).toHaveLength(0);
    expect(db.ontology_audit).toHaveLength(0);
    await expect(
      readFile(path.join(pkgRoot, "ontology", "thread.yaml"), "utf8"),
    ).rejects.toThrow();

    // Restore
    const restoreRes = await runRestore({
      pkgRoot,
      inFile: backupFile,
      databaseUrl: "postgres://fake",
      pgExec: exec,
    });
    expect(restoreRes.ok).toBe(true);

    // /members rows identical (pg_restore replays this from db.sql snapshot)
    expect(db.members).toEqual(initialMembers);

    // /audit rows identical (also replayed via pg_dump in this fake)
    expect(db.ontology_audit.map((r) => r.id).sort()).toEqual(
      initialOntologyAudit,
    );
    expect(db.action_audit.map((r) => r.id).sort()).toEqual(initialActionAudit);

    // Ontology files restored
    const yaml = await readFile(
      path.join(pkgRoot, "ontology", "thread.yaml"),
      "utf8",
    );
    expect(yaml).toContain("Thread");
  });

  it("supports replay-audit when DB restore left audit empty", async () => {
    const backupFile = path.join(workdir, "backup.tgz");
    const initialAuditIds = [
      ...db.ontology_audit.map((r) => r.id),
      ...db.action_audit.map((r) => r.id),
    ].sort();

    await runBackup({
      pkgRoot,
      outFile: backupFile,
      databaseUrl: "postgres://fake",
      pgExec: exec,
    });

    // Disaster: lose everything including audit
    db.members = [];
    db.ontology_audit = [];
    db.action_audit = [];

    // Replace exec.restore with a version that ONLY restores members,
    // not audit — simulates a DBA reseeding from a manual schema export
    // who forgot the audit tables.
    exec.restore = async () => {
      db.members = [
        { id: "m-1", name: "Alice" },
        { id: "m-2", name: "Bob" },
      ];
    };

    const restoreRes = await runRestore({
      pkgRoot,
      inFile: backupFile,
      databaseUrl: "postgres://fake",
      pgExec: exec,
      replayAudit: true,
    });
    expect(restoreRes.ok).toBe(true);
    expect(restoreRes.replayedAuditCounts).toEqual({
      ontology_audit: 1,
      action_audit: 1,
    });

    const restoredAuditIds = [
      ...db.ontology_audit.map((r) => r.id),
      ...db.action_audit.map((r) => r.id),
    ].sort();
    expect(restoredAuditIds).toEqual(initialAuditIds);
  });
});
