/**
 * A1 hardening proof script — verifies the 3 negativa HIGH fixes.
 *
 * FIX 1 (payload guard): End-to-end HTTP proof — inserts null/array/string payload rows
 *   via psql, POSTs to /api/organize/classify with a steward session, asserts 422.
 *   No LLM dependency (guard fires before generateText).
 *
 * FIX 2 (field_map validation): Pure helper import — asserts validateFieldMap
 *   returns ok=true for valid fields and ok=false for invalid fields.
 *   No HTTP or LLM dependency (pure function, deterministic).
 *
 * FIX 3 (generateText wrap): Inspection-level proof — the try/catch is structural
 *   code review (cannot trigger a live provider outage deterministically).
 *   Disclosed honestly.
 *
 * Usage: docker exec acropolisos-app npx tsx scripts/classify-hardening-proof.ts
 * Note: docker restart required after editing existing route files (hot-reload
 *       does not always pick up bind-mount changes without a restart).
 */

import { execFileSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { validateFieldMap } from "../app/api/organize/classify/route";

const BASE_URL = "http://localhost:3030";

// ─── helpers ────────────────────────────────────────────────────────────────

/** Execute SQL via a temp file to avoid shell-quoting issues. */
function psqlFile(sql: string): string {
  const tmp = `/tmp/_proof_${Date.now()}.sql`;
  writeFileSync(tmp, sql);
  try {
    return execFileSync("psql", [process.env.DATABASE_URL!, "-f", tmp, "-tA"], {
      encoding: "utf-8",
    }).trim();
  } finally {
    try { unlinkSync(tmp); } catch {}
  }
}

/** Get a steward session cookie via NextAuth credentials flow. */
async function getStewardCookie(): Promise<string> {
  const csrfRes = await fetch(`${BASE_URL}/api/auth/csrf`);
  if (!csrfRes.ok) throw new Error(`CSRF fetch failed: ${csrfRes.status}`);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };
  const csrfCookie = csrfRes.headers.get("set-cookie")!.split(";")[0];

  const loginRes = await fetch(`${BASE_URL}/api/auth/callback/credentials`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: csrfCookie },
    body: new URLSearchParams({
      csrfToken,
      email: "steward@acropolisos.local",
      password: "acropolis2026",
      callbackUrl: "/",
      json: "true",
    }),
    redirect: "manual",
  });

  const rawCookies = loginRes.headers.get("set-cookie") ?? "";
  // Two cookies separated by ", authjs." — split carefully
  const parts = rawCookies.split(/,\s*(?=authjs\.)/).map((c) => c.split(";")[0]);
  return csrfCookie + "; " + parts.join("; ");
}

async function classifyRequest(inboxId: string, cookie: string) {
  const res = await fetch(`${BASE_URL}/api/organize/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ inbox_id: inboxId }),
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { raw: text }; }
  return { status: res.status, body };
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  let allPassed = true;

  // ── FIX 2: Pure helper — deterministic, no HTTP/LLM ────────────────────────
  console.log("\n=== FIX 2: validateFieldMap helper (pure, no LLM) ===");

  const check1 = validateFieldMap("guest", { name: "full_name" });
  const pass1 = check1.ok === true;
  console.log(
    `  validateFieldMap("guest", { name: "full_name" }).ok === true  →  ${pass1 ? "PASS" : "FAIL"} (got: ${JSON.stringify(check1)})`
  );
  if (!pass1) allPassed = false;

  const check2 = validateFieldMap("guest", { x: "passport_number" });
  const pass2 = check2.ok === false && (check2 as { ok: false; invalid: string[] }).invalid.includes("passport_number");
  console.log(
    `  validateFieldMap("guest", { x: "passport_number" }).ok === false  →  ${pass2 ? "PASS" : "FAIL"} (got: ${JSON.stringify(check2)})`
  );
  if (!pass2) allPassed = false;

  // Mixed: valid + invalid values
  const check3 = validateFieldMap("member", { a: "full_name", b: "nonexistent_col" });
  const pass3 = check3.ok === false;
  console.log(
    `  validateFieldMap("member", { a: "full_name", b: "nonexistent_col" }).ok === false  →  ${pass3 ? "PASS" : "FAIL"} (got: ${JSON.stringify(check3)})`
  );
  if (!pass3) allPassed = false;

  // All valid for booking
  const check4 = validateFieldMap("booking", { a: "label", b: "status" });
  const pass4 = check4.ok === true;
  console.log(
    `  validateFieldMap("booking", { a: "label", b: "status" }).ok === true  →  ${pass4 ? "PASS" : "FAIL"} (got: ${JSON.stringify(check4)})`
  );
  if (!pass4) allPassed = false;

  // ── FIX 1: Payload guard — end-to-end HTTP (no LLM, guard fires before it) ──
  console.log("\n=== FIX 1: Payload guard — end-to-end HTTP (no LLM dependency) ===");

  // Insert test rows via SQL file (avoids shell quoting entirely)
  const nullId = psqlFile(
    "insert into raw_inbox(source,payload) values('test-null','null'::jsonb) returning id;"
  ).split("\n")[0];
  const arrayId = psqlFile(
    "insert into raw_inbox(source,payload) values('test-array','[1,2]'::jsonb) returning id;"
  ).split("\n")[0];
  const stringId = psqlFile(
    `insert into raw_inbox(source,payload) values('test-string','"hello"'::jsonb) returning id;`
  ).split("\n")[0];
  console.log(`  Inserted test rows: null=${nullId} array=${arrayId} string=${stringId}`);

  const cookie = await getStewardCookie();
  console.log(`  Steward session acquired (cookie length=${cookie.length})`);

  for (const [label, id] of [["null", nullId], ["array", arrayId], ["string", stringId]] as const) {
    const { status, body } = await classifyRequest(id, cookie);
    const ok = status === 422 && (body as Record<string, unknown>).error === "unclassifiable_payload";
    console.log(
      `  ${label} payload → HTTP ${status} ${JSON.stringify(body)} → ${ok ? "PASS" : "FAIL"}`
    );
    if (!ok) allPassed = false;
  }

  psqlFile("delete from raw_inbox where source like 'test-%';");
  console.log("  Cleanup done.");

  // ── FIX 3: generateText wrap — inspection level (cannot trigger live outage) ──
  console.log("\n=== FIX 3: generateText try/catch — INSPECTION LEVEL (disclosed) ===");
  console.log("  Cannot trigger a real provider outage deterministically.");
  console.log("  Structural diff (app/api/organize/classify/route.ts):");
  console.log("");
  console.log("  BEFORE (sha a0a7e4cdd, no try/catch):");
  console.log("    const textResult = await generateText({ model, prompt });");
  console.log("    // any throw → uncaught 500");
  console.log("");
  console.log("  AFTER (this commit):");
  console.log("    let textResult: Awaited<ReturnType<typeof generateText>>;");
  console.log("    try {");
  console.log("      textResult = await generateText({ model, prompt });");
  console.log("    } catch (err) {");
  console.log("      return Response.json(");
  console.log("        { error: 'llm_unavailable', detail: err instanceof Error ? err.message : String(err) },");
  console.log("        { status: 503 },");
  console.log("      );");
  console.log("    }");
  console.log("  Mirrors existing llm_not_configured 503 block. Code review: PASS.");

  // ── Summary ──────────────────────────────────────────────────────────────────
  console.log("\n=== SUMMARY ===");
  console.log(`  FIX 1 (payload guard):      ${allPassed ? "PASS" : "PARTIAL"} — 422 on null/array/string payloads (HTTP, no LLM)`);
  console.log(`  FIX 2 (field_map validate): ${pass1 && pass2 && pass3 && pass4 ? "PASS" : "FAIL"} — validateFieldMap pure helper (4/4 assertions)`);
  console.log(`  FIX 3 (LLM wrap):           INSPECTION — structural try/catch, no live outage triggered`);
  console.log(`  Overall: ${allPassed ? "ALL DETERMINISTIC CHECKS PASSED" : "ONE OR MORE CHECKS FAILED"}`);

  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error("Proof script error:", err);
  process.exit(1);
});
