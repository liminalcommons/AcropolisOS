import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isSetupComplete, markSetupComplete } from "./state";

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
