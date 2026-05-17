import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copySeedOntology } from "./seed-copy";

let dir: string;
let src: string;
let dest: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "acrop-seed-"));
  src = path.join(dir, "src");
  dest = path.join(dir, "dest");
  await mkdir(path.join(src, "nested"), { recursive: true });
  await writeFile(path.join(src, "roles.yaml"), "roles: []\n", "utf8");
  await writeFile(path.join(src, "nested", "a.yaml"), "a: 1\n", "utf8");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("copySeedOntology", () => {
  it("copies the entire source tree into destination", async () => {
    await copySeedOntology(src, dest);
    expect(await readFile(path.join(dest, "roles.yaml"), "utf8")).toBe(
      "roles: []\n",
    );
    expect(await readFile(path.join(dest, "nested", "a.yaml"), "utf8")).toBe(
      "a: 1\n",
    );
  });

  it("creates the destination if it does not exist", async () => {
    const deep = path.join(dest, "not", "there", "yet");
    await copySeedOntology(src, deep);
    expect(await readFile(path.join(deep, "roles.yaml"), "utf8")).toBe(
      "roles: []\n",
    );
  });

  it("overwrites pre-existing files at the destination", async () => {
    await mkdir(dest, { recursive: true });
    await writeFile(path.join(dest, "roles.yaml"), "stale\n", "utf8");
    await copySeedOntology(src, dest);
    expect(await readFile(path.join(dest, "roles.yaml"), "utf8")).toBe(
      "roles: []\n",
    );
  });

  it("rejects when source does not exist", async () => {
    await expect(
      copySeedOntology(path.join(dir, "missing"), dest),
    ).rejects.toThrow();
  });
});
