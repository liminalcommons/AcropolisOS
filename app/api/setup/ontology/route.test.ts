import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let setupFile: string;
let seedRoot: string;
let runtimeOntologyDir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "acrop-route-ont-"));
  setupFile = path.join(dir, "setup.json");
  seedRoot = path.join(dir, "seed");
  runtimeOntologyDir = path.join(dir, "ontology");

  await mkdir(path.join(seedRoot, "empty"), { recursive: true });
  await writeFile(
    path.join(seedRoot, "empty", "roles.yaml"),
    "roles: []\n",
    "utf8",
  );
  await mkdir(path.join(seedRoot, "small-community"), { recursive: true });
  await writeFile(
    path.join(seedRoot, "small-community", "roles.yaml"),
    "roles:\n  - name: member\n",
    "utf8",
  );

  process.env.ACROPOLISOS_SETUP_FILE = setupFile;
  process.env.ACROPOLISOS_SEED_ROOT = seedRoot;
  process.env.ACROPOLISOS_ONTOLOGY_DIR = runtimeOntologyDir;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.ACROPOLISOS_SETUP_FILE;
  delete process.env.ACROPOLISOS_SEED_ROOT;
  delete process.env.ACROPOLISOS_ONTOLOGY_DIR;
  await rm(dir, { recursive: true, force: true });
});

function mockHooks(opts: { codegen?: () => Promise<void>; migrate?: () => Promise<void> } = {}) {
  vi.doMock("@/lib/setup/codegen-runner", () => ({
    runCodegen: vi.fn(opts.codegen ?? (() => Promise.resolve())),
    runMigrations: vi.fn(opts.migrate ?? (() => Promise.resolve())),
  }));
}

async function importRoute() {
  return import("./route");
}

describe("POST /api/setup/ontology", () => {
  it("rejects unknown seed names", async () => {
    mockHooks();
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/ontology", {
        method: "POST",
        body: JSON.stringify({ seed: "nope" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("copies the picked seed, runs codegen+migrations, and marks complete", async () => {
    const codegen = vi.fn(() => Promise.resolve());
    const migrate = vi.fn(() => Promise.resolve());
    mockHooks({ codegen, migrate });
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/ontology", {
        method: "POST",
        body: JSON.stringify({ seed: "small-community" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(
      await readFile(path.join(runtimeOntologyDir, "roles.yaml"), "utf8"),
    ).toContain("member");
    expect(codegen).toHaveBeenCalledOnce();
    expect(migrate).toHaveBeenCalledOnce();
    const marker = JSON.parse(await readFile(setupFile, "utf8"));
    expect(marker.completed).toBe(true);
  });

  it("does not mark complete if migrations fail", async () => {
    mockHooks({ migrate: () => Promise.reject(new Error("DB down")) });
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/ontology", {
        method: "POST",
        body: JSON.stringify({ seed: "empty" }),
      }),
    );
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/DB down/);
    await expect(readFile(setupFile, "utf8")).rejects.toThrow();
  });

  it("rejects with 409 once setup is already complete", async () => {
    mockHooks();
    await writeFile(setupFile, JSON.stringify({ completed: true }), "utf8");
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/ontology", {
        method: "POST",
        body: JSON.stringify({ seed: "empty" }),
      }),
    );
    expect(res.status).toBe(409);
  });
});
