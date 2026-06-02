// lib/channels/discord/verify.test.ts
//
// verifyDiscordSignature is the SYNCHRONOUS source of truth for Discord's
// Ed25519 interaction-authenticity check. Discord signs the concatenation
// (X-Signature-Timestamp + RAW request body) with the application's Ed25519
// private key; the endpoint verifies with the PUBLIC KEY (DISCORD_PUBLIC_KEY,
// a 64-char hex string).
//
// We generate a real ed25519 keypair here, sign (timestamp + rawBody), and
// assert the helper returns true for a valid signature and false (NEVER throws)
// for every tampered/malformed input. The constant-time property is a property
// of node:crypto's Ed25519 verify primitive — we do NOT hand-roll a byte
// compare and do not claim a custom constant-time implementation.

import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyDiscordSignature } from "@/lib/channels/discord/verify";

// Build a keypair and return the raw 32-byte public key as hex (the form
// Discord publishes) plus a signer over (timestamp + rawBody).
function makeKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const rawPubHex = Buffer.from(spki.subarray(spki.length - 32)).toString("hex");
  return {
    publicKeyHex: rawPubHex,
    signHex(timestamp: string, rawBody: string): string {
      return sign(null, Buffer.from(timestamp + rawBody), privateKey).toString("hex");
    },
  };
}

describe("verifyDiscordSignature", () => {
  const timestamp = "1717200000";
  const rawBody = JSON.stringify({ type: 2, id: "abc", data: { name: "report" } });

  it("returns true for a correctly signed (timestamp + rawBody)", () => {
    const kp = makeKeypair();
    const sigHex = kp.signHex(timestamp, rawBody);
    expect(verifyDiscordSignature(rawBody, sigHex, timestamp, kp.publicKeyHex)).toBe(true);
  });

  it("returns false for a tampered body (signature no longer matches)", () => {
    const kp = makeKeypair();
    const sigHex = kp.signHex(timestamp, rawBody);
    expect(verifyDiscordSignature(rawBody + " ", sigHex, timestamp, kp.publicKeyHex)).toBe(false);
  });

  it("returns false for a tampered timestamp", () => {
    const kp = makeKeypair();
    const sigHex = kp.signHex(timestamp, rawBody);
    expect(verifyDiscordSignature(rawBody, sigHex, "9999999999", kp.publicKeyHex)).toBe(false);
  });

  it("returns false for a signature from a different key", () => {
    const signer = makeKeypair();
    const other = makeKeypair();
    const sigHex = signer.signHex(timestamp, rawBody);
    expect(verifyDiscordSignature(rawBody, sigHex, timestamp, other.publicKeyHex)).toBe(false);
  });

  it("returns false (never throws) for a non-hex signature", () => {
    const kp = makeKeypair();
    expect(verifyDiscordSignature(rawBody, "zznothex", timestamp, kp.publicKeyHex)).toBe(false);
  });

  it("returns false (never throws) for an empty public key", () => {
    const kp = makeKeypair();
    const sigHex = kp.signHex(timestamp, rawBody);
    expect(verifyDiscordSignature(rawBody, sigHex, timestamp, "")).toBe(false);
  });

  it("returns false (never throws) for a short/garbage public key", () => {
    const kp = makeKeypair();
    const sigHex = kp.signHex(timestamp, rawBody);
    expect(verifyDiscordSignature(rawBody, sigHex, timestamp, "abcd")).toBe(false);
    expect(verifyDiscordSignature(rawBody, sigHex, timestamp, "nothexatall")).toBe(false);
  });

  it("returns false for an empty signature", () => {
    const kp = makeKeypair();
    expect(verifyDiscordSignature(rawBody, "", timestamp, kp.publicKeyHex)).toBe(false);
  });
});
