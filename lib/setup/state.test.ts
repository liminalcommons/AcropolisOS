import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSetupComplete, markSetupComplete, resolveInitialStep } from "./state";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "acrop-setup-"));
  file = path.join(dir, "setup.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("isSetupComplete", () => {
  it("returns false when the file does not exist", async () => {
    expect(await isSetupComplete(file)).toBe(false);
  });

  it("returns false when the file exists but is malformed", async () => {
    await writeFile(file, "not json", "utf8");
    expect(await isSetupComplete(file)).toBe(false);
  });

  it("returns false when completed is missing or falsy", async () => {
    await writeFile(file, JSON.stringify({}), "utf8");
    expect(await isSetupComplete(file)).toBe(false);
    await writeFile(file, JSON.stringify({ completed: false }), "utf8");
    expect(await isSetupComplete(file)).toBe(false);
  });

  it("returns true when completed is true", async () => {
    await writeFile(file, JSON.stringify({ completed: true }), "utf8");
    expect(await isSetupComplete(file)).toBe(true);
  });
});

describe("markSetupComplete", () => {
  it("writes the completion marker so subsequent isSetupComplete returns true", async () => {
    expect(await isSetupComplete(file)).toBe(false);
    await markSetupComplete(file);
    expect(await isSetupComplete(file)).toBe(true);
  });
});

describe("resolveInitialStep (B12 wizard resume)", () => {
  let envFile: string;
  let usersFile: string;
  beforeEach(() => {
    envFile = path.join(dir, ".env");
    usersFile = path.join(dir, "users.json");
  });

  it("returns 1 when nothing is configured", async () => {
    expect(await resolveInitialStep({ envFile, usersFile })).toBe(1);
  });

  it("returns 1 when env has only LLM_PROVIDER but no key (non-ollama)", async () => {
    await writeFile(envFile, "LLM_PROVIDER=anthropic\n", "utf8");
    expect(await resolveInitialStep({ envFile, usersFile })).toBe(1);
  });

  it("returns 2 when provider+key are present but no users", async () => {
    await writeFile(
      envFile,
      "LLM_PROVIDER=anthropic\nLLM_API_KEY=sk-x\n",
      "utf8",
    );
    expect(await resolveInitialStep({ envFile, usersFile })).toBe(2);
  });

  it("returns 2 when ollama is set (no key required) but no users", async () => {
    await writeFile(envFile, "LLM_PROVIDER=ollama\n", "utf8");
    expect(await resolveInitialStep({ envFile, usersFile })).toBe(2);
  });

  it("returns 3 when provider configured and at least one user exists", async () => {
    await writeFile(
      envFile,
      "LLM_PROVIDER=opencode\nLLM_API_KEY=sk-y\n",
      "utf8",
    );
    await writeFile(
      usersFile,
      JSON.stringify({ users: [{ id: "u1", email: "s@a.com" }] }),
      "utf8",
    );
    expect(await resolveInitialStep({ envFile, usersFile })).toBe(3);
  });

  it("returns 2 when users.json is malformed (treats as empty)", async () => {
    await writeFile(
      envFile,
      "LLM_PROVIDER=openai\nLLM_API_KEY=sk-z\n",
      "utf8",
    );
    await writeFile(usersFile, "not json", "utf8");
    expect(await resolveInitialStep({ envFile, usersFile })).toBe(2);
  });
});
