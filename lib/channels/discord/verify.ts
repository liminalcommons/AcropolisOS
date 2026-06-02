// lib/channels/discord/verify.ts
//
// verifyDiscordSignature — the SYNCHRONOUS source of truth for Discord's
// Ed25519 interaction-authenticity check, with ZERO new dependencies (node:crypto).
//
// Discord's Interactions Endpoint signs the concatenation
//   (X-Signature-Timestamp header) + (RAW request body bytes)
// with the application's Ed25519 private key. The endpoint verifies that
// signature against the application PUBLIC KEY (DISCORD_PUBLIC_KEY — a 64-char
// hex string = the raw 32-byte Ed25519 public key).
//
// node:crypto verifies Ed25519 SYNCHRONOUSLY when the raw 32-byte key is wrapped
// in its DER/SPKI envelope (the fixed 12-byte prefix below). This synchronous
// path is deliberate: it keeps verification usable from the SYNC ChannelAdapter
// surface and avoids webcrypto's async subtle.verify (which would force the
// ChannelAdapter.verifyRequest contract to become async).
//
// The signature comparison inside crypto.verify is constant-time — a property of
// the Ed25519 verify primitive. We never hand-roll a byte comparison and make no
// claim of a custom constant-time implementation. Any malformed input (bad hex,
// wrong-length key, empty values) is caught and returns false; this function
// NEVER throws and NEVER logs the public key, signature, or timestamp.

import { createPublicKey, verify as cryptoVerify } from "node:crypto";

// DER/SPKI prefix for an Ed25519 public key (RFC 8410): SEQUENCE + AlgorithmId
// (1.3.101.112) + BIT STRING header. The raw 32-byte key follows.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const ED25519_RAW_KEY_BYTES = 32;

/**
 * Verify a Discord interaction request's Ed25519 signature.
 *
 * @param rawBody       the EXACT raw request body string (read once via req.text())
 * @param signatureHex  the X-Signature-Ed25519 header value (hex)
 * @param timestamp     the X-Signature-Timestamp header value
 * @param publicKeyHex  the application public key (DISCORD_PUBLIC_KEY, raw 32-byte hex)
 * @returns true iff the signature is valid; false (never throws) otherwise
 */
export function verifyDiscordSignature(
  rawBody: string,
  signatureHex: string,
  timestamp: string,
  publicKeyHex: string,
): boolean {
  if (!signatureHex || !timestamp || !publicKeyHex) return false;
  try {
    const rawKey = Buffer.from(publicKeyHex, "hex");
    if (rawKey.length !== ED25519_RAW_KEY_BYTES) return false;

    const signature = Buffer.from(signatureHex, "hex");
    if (signature.length === 0) return false;

    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]),
      format: "der",
      type: "spki",
    });

    return cryptoVerify(null, Buffer.from(timestamp + rawBody), key, signature);
  } catch {
    // Malformed hex / key construction failure — treat as an invalid signature.
    return false;
  }
}
