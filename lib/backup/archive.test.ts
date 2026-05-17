import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { extractArchive, packArchive } from "./archive";

let workdir = "";

beforeEach(async () => {
  workdir = await mkdtemp(path.join(tmpdir(), "aos-archive-"));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe("packArchive + extractArchive", () => {
  it("roundtrips a directory tree as a .tgz archive", async () => {
    const src = path.join(workdir, "src");
    await mkdir(path.join(src, "ontology"), { recursive: true });
    await mkdir(path.join(src, "uploads"), { recursive: true });
    await writeFile(path.join(src, "manifest.json"), '{"version":"v1"}');
    await writeFile(
      path.join(src, "ontology", "thread.yaml"),
      "kind: object_type\nname: Thread\n",
    );
    await writeFile(path.join(src, "uploads", "hello.txt"), "hello\n");

    const outFile = path.join(workdir, "backup.tgz");
    await packArchive({ srcDir: src, outFile });

    const dest = path.join(workdir, "dest");
    await mkdir(dest, { recursive: true });
    await extractArchive({ inFile: outFile, destDir: dest });

    const manifest = await readFile(path.join(dest, "manifest.json"), "utf8");
    expect(manifest).toBe('{"version":"v1"}');
    const yaml = await readFile(
      path.join(dest, "ontology", "thread.yaml"),
      "utf8",
    );
    expect(yaml).toContain("Thread");
    const upload = await readFile(path.join(dest, "uploads", "hello.txt"), "utf8");
    expect(upload).toBe("hello\n");

    const entries = await readdir(dest);
    expect(entries.sort()).toEqual(["manifest.json", "ontology", "uploads"]);
  });

  it("packArchive fails clearly when srcDir does not exist", async () => {
    const missing = path.join(workdir, "nope");
    const outFile = path.join(workdir, "backup.tgz");
    await expect(packArchive({ srcDir: missing, outFile })).rejects.toThrow();
  });
});
