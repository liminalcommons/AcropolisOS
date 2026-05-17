import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;
let setupFile: string;
let envFile: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "acrop-route-prov-"));
  setupFile = path.join(dir, "setup.json");
  envFile = path.join(dir, ".env");
  process.env.ACROPOLISOS_SETUP_FILE = setupFile;
  process.env.ACROPOLISOS_ENV_FILE = envFile;
  vi.resetModules();
});

afterEach(async () => {
  delete process.env.ACROPOLISOS_SETUP_FILE;
  delete process.env.ACROPOLISOS_ENV_FILE;
  await rm(dir, { recursive: true, force: true });
});

async function importRoute() {
  return import("./route");
}

describe("POST /api/setup/provider", () => {
  it("returns 400 on invalid body", async () => {
    vi.doMock("@/lib/setup/provider", () => ({
      validateProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    }));
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/provider", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when provider missing", async () => {
    vi.doMock("@/lib/setup/provider", () => ({
      validateProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    }));
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/provider", {
        method: "POST",
        body: JSON.stringify({ apiKey: "x" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("returns 422 when key validation fails against provider", async () => {
    const validate = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "401 Unauthorized" });
    vi.doMock("@/lib/setup/provider", () => ({
      validateProviderKey: validate,
    }));
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/provider", {
        method: "POST",
        body: JSON.stringify({ provider: "anthropic", apiKey: "bad" }),
      }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/401/);
  });

  it("on success writes env vars and returns 200", async () => {
    vi.doMock("@/lib/setup/provider", () => ({
      validateProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    }));
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/provider", {
        method: "POST",
        body: JSON.stringify({ provider: "anthropic", apiKey: "sk-good" }),
      }),
    );
    expect(res.status).toBe(200);
    const env = await readFile(envFile, "utf8");
    expect(env).toMatch(/^LLM_PROVIDER=anthropic$/m);
    expect(env).toMatch(/^LLM_API_KEY=sk-good$/m);
  });

  it("rejects with 409 once setup is complete", async () => {
    await writeFile(setupFile, JSON.stringify({ completed: true }), "utf8");
    vi.doMock("@/lib/setup/provider", () => ({
      validateProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    }));
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/provider", {
        method: "POST",
        body: JSON.stringify({ provider: "anthropic", apiKey: "sk" }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("ollama: empty key permitted, baseURL persisted", async () => {
    vi.doMock("@/lib/setup/provider", () => ({
      validateProviderKey: vi.fn().mockResolvedValue({ ok: true }),
    }));
    const { POST } = await importRoute();
    const res = await POST(
      new Request("http://localhost/api/setup/provider", {
        method: "POST",
        body: JSON.stringify({
          provider: "ollama",
          apiKey: "",
          baseURL: "http://ollama:11434",
        }),
      }),
    );
    expect(res.status).toBe(200);
    const env = await readFile(envFile, "utf8");
    expect(env).toMatch(/^LLM_PROVIDER=ollama$/m);
    expect(env).toMatch(/^LLM_BASE_URL=http:\/\/ollama:11434$/m);
  });
});
