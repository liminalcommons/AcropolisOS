import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let setupFile: string;
let usersFile: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "acrop-route-stew-"));
  setupFile = path.join(dir, "setup.json");
  usersFile = path.join(dir, "users.json");
  process.env.ACROPOLISOS_SETUP_FILE = setupFile;
  process.env.ACROPOLISOS_USERS_FILE = usersFile;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.ACROPOLISOS_SETUP_FILE;
  delete process.env.ACROPOLISOS_USERS_FILE;
  await rm(dir, { recursive: true, force: true });
});

async function importRoute() {
  return import("./route");
}

describe("POST /api/setup/steward", () => {
  it("rejects malformed body", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/steward", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects missing email or password", async () => {
    const { POST } = await importRoute();
    let res = await POST(
      new Request("http://localhost/api/setup/steward", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.com" }),
      }),
    );
    expect(res.status).toBe(400);
    res = await POST(
      new Request("http://localhost/api/setup/steward", {
        method: "POST",
        body: JSON.stringify({ password: "secret123" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("rejects passwords shorter than 8 chars", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/steward", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "short" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("creates the steward and returns 200", async () => {
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/steward", {
        method: "POST",
        body: JSON.stringify({ email: "founder@example.com", password: "supersecret" }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe("founder@example.com");
    // password must NOT be echoed
    expect(JSON.stringify(body)).not.toMatch(/supersecret/);
  });

  it("rejects with 409 if a steward already exists", async () => {
    const { POST } = await importRoute();
    await POST(
      new Request("http://localhost/api/setup/steward", {
        method: "POST",
        body: JSON.stringify({ email: "first@example.com", password: "supersecret" }),
      }),
    );
    const res = await POST(
      new Request("http://localhost/api/setup/steward", {
        method: "POST",
        body: JSON.stringify({ email: "second@example.com", password: "supersecret" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("rejects with 409 once setup is complete", async () => {
    await writeFile(setupFile, JSON.stringify({ completed: true }), "utf8");
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/steward", {
        method: "POST",
        body: JSON.stringify({ email: "a@b.com", password: "supersecret" }),
      }),
    );
    expect(res.status).toBe(409);
  });
});
