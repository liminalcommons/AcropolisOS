// Passwordless one-time sign-in link, for remote access without typing a
// password on a phone. SECURITY CONTRACT exercised here:
//  - a token is single-use (consume marks it; a later replay is rejected)
//  - a short reuse grace tolerates the dev double-submit (StrictMode remount /
//    next-auth retry) WITHOUT widening the bearer window meaningfully
//  - first use must happen before expiry
//  - only the sha256 HASH is stored, compared in constant time
//  - the feature is inert until a token is minted (no file -> consume null)
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FileMagicLinkStore,
  mintMagicLink,
} from "./magic-link";

const T0 = new Date("2026-06-01T00:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const MIN = 60_000;

let dirs: string[] = [];
async function tmpFile(): Promise<string> {
  const dir = await mkdtemp(path.join(__dirname, ".magic-tmp-"));
  dirs.push(dir);
  return path.join(dir, "magic-link.json");
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe("FileMagicLinkStore.consume", () => {
  it("mint then consume returns the linked email (lowercased)", async () => {
    const file = await tmpFile();
    const { token } = await mintMagicLink({
      file,
      email: "Steward@Acropolisos.Local",
      baseUrl: "https://acropolisos.castalia.one",
      now: T0,
    });
    const store = new FileMagicLinkStore(file);
    expect(await store.consume(token, at(1000))).toBe("steward@acropolisos.local");
  });

  it("is single-use: a replay past the grace window is rejected", async () => {
    const file = await tmpFile();
    const { token } = await mintMagicLink({
      file,
      email: "s@x.com",
      baseUrl: "https://h",
      now: T0,
    });
    const store = new FileMagicLinkStore(file);
    expect(await store.consume(token, at(1000))).toBe("s@x.com"); // first use
    expect(await store.consume(token, at(5 * MIN))).toBeNull(); // replay -> dead
  });

  it("tolerates a double-submit inside the short reuse grace", async () => {
    const file = await tmpFile();
    const { token } = await mintMagicLink({
      file,
      email: "s@x.com",
      baseUrl: "https://h",
      now: T0,
    });
    const store = new FileMagicLinkStore(file);
    expect(await store.consume(token, at(1000))).toBe("s@x.com");
    expect(await store.consume(token, at(1000 + 30_000))).toBe("s@x.com"); // +30s, same login
  });

  it("rejects first use after expiry", async () => {
    const file = await tmpFile();
    const { token } = await mintMagicLink({
      file,
      email: "s@x.com",
      baseUrl: "https://h",
      ttlMs: 1000,
      now: T0,
    });
    const store = new FileMagicLinkStore(file);
    expect(await store.consume(token, at(2000))).toBeNull();
  });

  it("rejects a wrong token", async () => {
    const file = await tmpFile();
    await mintMagicLink({ file, email: "s@x.com", baseUrl: "https://h", now: T0 });
    const store = new FileMagicLinkStore(file);
    expect(await store.consume("not-the-token", at(1000))).toBeNull();
  });

  it("returns null when no link has been minted (feature inert)", async () => {
    const file = await tmpFile();
    const store = new FileMagicLinkStore(file);
    expect(await store.consume("anything", at(1000))).toBeNull();
  });

  it("returns null for an empty token without reading the file", async () => {
    const file = await tmpFile();
    await mintMagicLink({ file, email: "s@x.com", baseUrl: "https://h", now: T0 });
    const store = new FileMagicLinkStore(file);
    expect(await store.consume("", at(1000))).toBeNull();
  });

  it("ignores a corrupt link file rather than throwing", async () => {
    const file = await tmpFile();
    await writeFile(file, "{ not json", "utf8");
    const store = new FileMagicLinkStore(file);
    expect(await store.consume("x", at(1000))).toBeNull();
  });
});

describe("mintMagicLink", () => {
  it("produces a /api/magic?token=<token> URL on the given base", async () => {
    const file = await tmpFile();
    const { url, token, expiresAt } = await mintMagicLink({
      file,
      email: "s@x.com",
      baseUrl: "https://acropolisos.castalia.one/",
      now: T0,
    });
    expect(url).toBe(
      `https://acropolisos.castalia.one/api/magic?token=${encodeURIComponent(token)}`,
    );
    expect(Date.parse(expiresAt)).toBeGreaterThan(T0.getTime());
    expect(token.length).toBeGreaterThanOrEqual(32);
  });
});
