import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { upsertEnvVars } from "./env-write";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "acrop-env-"));
  file = path.join(dir, ".env");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("upsertEnvVars", () => {
  it("creates the file when missing", async () => {
    await upsertEnvVars(file, { LLM_PROVIDER: "anthropic", LLM_API_KEY: "sk-x" });
    const raw = await readFile(file, "utf8");
    expect(raw).toMatch(/^LLM_PROVIDER=anthropic$/m);
    expect(raw).toMatch(/^LLM_API_KEY=sk-x$/m);
  });

  it("replaces existing keys without duplicating", async () => {
    await writeFile(
      file,
      "DATABASE_URL=postgres://existing\nLLM_PROVIDER=openai\nLLM_API_KEY=old\n",
      "utf8",
    );
    await upsertEnvVars(file, { LLM_PROVIDER: "anthropic", LLM_API_KEY: "new" });
    const raw = await readFile(file, "utf8");
    expect(raw).toMatch(/DATABASE_URL=postgres:\/\/existing/);
    expect(raw).toMatch(/^LLM_PROVIDER=anthropic$/m);
    expect(raw).toMatch(/^LLM_API_KEY=new$/m);
    expect(raw.match(/LLM_API_KEY=/g)?.length ?? 0).toBe(1);
    expect(raw.match(/LLM_PROVIDER=/g)?.length ?? 0).toBe(1);
  });

  it("appends keys not previously present", async () => {
    await writeFile(file, "DATABASE_URL=postgres://x\n", "utf8");
    await upsertEnvVars(file, { LLM_BASE_URL: "http://ollama:11434" });
    const raw = await readFile(file, "utf8");
    expect(raw).toMatch(/DATABASE_URL=postgres:\/\/x/);
    expect(raw).toMatch(/^LLM_BASE_URL=http:\/\/ollama:11434$/m);
  });

  it("quotes values containing whitespace", async () => {
    await upsertEnvVars(file, { LLM_API_KEY: "key with space" });
    const raw = await readFile(file, "utf8");
    expect(raw).toMatch(/^LLM_API_KEY="key with space"$/m);
  });

  it("trims trailing newlines but preserves prior content", async () => {
    await writeFile(file, "FOO=bar\n\n\n", "utf8");
    await upsertEnvVars(file, { BAZ: "qux" });
    const raw = await readFile(file, "utf8");
    expect(raw).toMatch(/^FOO=bar$/m);
    expect(raw).toMatch(/^BAZ=qux$/m);
    expect(raw.endsWith("\n")).toBe(true);
  });
});
