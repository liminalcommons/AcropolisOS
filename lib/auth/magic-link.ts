// Passwordless one-time sign-in link.
//
// Why this exists: acropolisOS is published behind a tunnel
// (acropolisos.castalia.one) so the steward can inspect the instance from a
// phone. Typing a password on mobile is the step that kept failing, and the
// app must NOT be left unauthenticated on the public internet (it drives an
// LLM with a BYOK key and can mutate org data). A magic link squares the
// circle: tap once, you're in, no password — and only whoever holds the
// (unguessable, single-use, expiring) token gets through.
//
// Security properties:
//  - the token is 256 bits of CSPRNG entropy; only its sha256 HASH is stored,
//    compared in constant time, so a leak of the data file does not grant access
//  - single-use: the first successful consume marks it; a later replay fails
//  - a short reuse grace tolerates the dev double-submit (React StrictMode
//    effect remount / next-auth retry) for the SAME login without widening the
//    bearer window meaningfully
//  - first use must occur before expiry
//  - INERT until minted: with no data file, consume() always returns null, so
//    there is no standing auth bypass — the surface exists only while a token does
//
// Minting is an operator action (scripts/mint-magic-link.ts, run in the
// container) — it is never reachable over the web.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

const PKG_ROOT = process.env.ACROPOLISOS_PKG_ROOT ?? process.cwd();

export function defaultMagicLinkFile(): string {
  return (
    process.env.ACROPOLISOS_MAGIC_FILE ??
    path.join(PKG_ROOT, "data", "magic-link.json")
  );
}

// A token already used may be re-presented within this window and still
// succeed — this covers the same-login double submit only (StrictMode remount,
// client retry). Beyond it, a used token is dead.
const REUSE_GRACE_MS = 2 * 60_000;

// Default lifetime for the FIRST use of a freshly minted token. The token is
// expected to be tapped immediately; the window is generous slack, not a
// long-lived credential. The resulting NextAuth session lasts the usual 30d.
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface MagicLinkRecord {
  /** sha256 hex of the plaintext token */
  tokenHash: string;
  /** the (lowercased) user email this link signs in */
  email: string;
  /** ISO timestamp; first use must be at or before this instant */
  expiresAt: string;
  /** ISO timestamp of the first successful consume, or null if never used */
  usedAt: string | null;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // timingSafeEqual throws on length mismatch; sha256 hex is always 64 chars,
  // but a malformed stored value must fail closed, not throw.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function readRecord(file: string): Promise<MagicLinkRecord | null> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<MagicLinkRecord>;
    if (
      typeof parsed.tokenHash !== "string" ||
      typeof parsed.email !== "string" ||
      typeof parsed.expiresAt !== "string"
    ) {
      return null;
    }
    return {
      tokenHash: parsed.tokenHash,
      email: parsed.email,
      expiresAt: parsed.expiresAt,
      usedAt: typeof parsed.usedAt === "string" ? parsed.usedAt : null,
    };
  } catch {
    // Corrupt file: fail closed (no auth) rather than throwing on every request.
    return null;
  }
}

async function writeRecord(file: string, rec: MagicLinkRecord): Promise<void> {
  const dir = path.dirname(file);
  await mkdir(dir, { recursive: true });
  // Write-then-rename so a crash mid-write cannot corrupt the canonical file.
  const tmp = path.join(dir, `.magic-${randomUUID()}.tmp.json`);
  await writeFile(tmp, JSON.stringify(rec, null, 2), "utf8");
  await rename(tmp, file);
}

export interface MagicLinkStore {
  /**
   * Validate `token` and, on success, return the email it signs in (and mark
   * it used). Returns null for any failure: no link minted, wrong token,
   * expired, or already used beyond the reuse grace.
   */
  consume(token: string, now?: Date): Promise<string | null>;
}

export class FileMagicLinkStore implements MagicLinkStore {
  constructor(private readonly file: string) {}

  async consume(token: string, now: Date = new Date()): Promise<string | null> {
    if (!token) return null;
    const rec = await readRecord(this.file);
    if (!rec) return null;
    if (!constantTimeEqualHex(sha256Hex(token), rec.tokenHash)) return null;

    const nowMs = now.getTime();
    if (rec.usedAt === null) {
      if (nowMs > Date.parse(rec.expiresAt)) return null;
      await writeRecord(this.file, { ...rec, usedAt: now.toISOString() });
      return rec.email;
    }

    // Already used: honor only within the same-login reuse grace.
    const usedMs = Date.parse(rec.usedAt);
    if (Number.isFinite(usedMs) && nowMs - usedMs <= REUSE_GRACE_MS) {
      return rec.email;
    }
    return null;
  }
}

export interface MintResult {
  token: string;
  url: string;
  expiresAt: string;
}

export async function mintMagicLink(opts: {
  email: string;
  baseUrl: string;
  file?: string;
  ttlMs?: number;
  now?: Date;
}): Promise<MintResult> {
  const file = opts.file ?? defaultMagicLinkFile();
  const now = opts.now ?? new Date();
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  await writeRecord(file, {
    tokenHash: sha256Hex(token),
    email: opts.email.trim().toLowerCase(),
    expiresAt,
    usedAt: null,
  });
  const url = `${opts.baseUrl.replace(/\/+$/, "")}/api/magic?token=${encodeURIComponent(token)}`;
  return { token, url, expiresAt };
}
