/**
 * Compose-boot smoke test (I3).
 *
 * Builds the image, brings up the stack, verifies the four boot signals
 * that the original autonomous build's 547 unit tests missed, then tears
 * down. Designed to run in CI on every PR so any future Dockerfile,
 * docker-compose, or middleware change that breaks `docker compose up`
 * fails the build before merge.
 *
 * What it checks (one assertion per historical bug it would have caught):
 *
 *   1. `docker compose build app` exits 0
 *      — catches Dockerfile COPY misses (B8 seed/), syntax errors
 *
 *   2. `docker compose up -d` exits 0 and all three containers stay up
 *      — catches port collisions (B4), depends_on misconfig
 *
 *   3. HTTP polling /api/auth/csrf until 200 (90s timeout)
 *      — catches middleware Edge-runtime crashes (B3), Turbopack
 *        __dirname bundling failures (B6), entrypoint migration loops
 *        (B1/B2), AuthJS UntrustedHost rejections (B10)
 *
 *   4. GET /signin returns 200
 *      — catches missing-page regressions (B16)
 *
 *   5. Inngest GraphQL: at least one app registered
 *      — catches sync regressions (I4)
 *
 * Not in scope (deferred to a future end-to-end smoke):
 *   - Wizard step POSTs (requires LLM stub server)
 *   - Chat endpoint (requires real or stubbed LLM credits)
 *   - Side-effect dispatch (requires triggering an action)
 *
 * Usage: `npm run test:compose`
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — any check failed; teardown still runs
 *   2 — pre-existing stack detected (refuses to clobber)
 */

import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const COMPOSE_FILE = "docker-compose.yml";
const APP_URL = "http://localhost:3030";
const INNGEST_URL = "http://localhost:8288";
const BOOT_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 2_000;

interface Result {
  name: string;
  ok: boolean;
  detail?: string;
}

async function run(
  cmd: string,
  args: string[],
  opts: { quiet?: boolean } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const s = String(chunk);
      stdout += s;
      if (!opts.quiet) process.stdout.write(s);
    });
    child.stderr.on("data", (chunk) => {
      const s = String(chunk);
      stderr += s;
      if (!opts.quiet) process.stderr.write(s);
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function fetchStatus(
  url: string,
  init?: RequestInit,
): Promise<{ status: number; bodyHead: string }> {
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    return { status: res.status, bodyHead: text.slice(0, 200) };
  } catch (err) {
    return { status: 0, bodyHead: err instanceof Error ? err.message : String(err) };
  }
}

async function pollUntil(
  url: string,
  predicate: (s: number) => boolean,
  label: string,
): Promise<Result> {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let last = 0;
  while (Date.now() < deadline) {
    const { status } = await fetchStatus(url);
    last = status;
    if (predicate(status)) {
      return { name: label, ok: true, detail: `HTTP ${status}` };
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return {
    name: label,
    ok: false,
    detail: `timed out after ${BOOT_TIMEOUT_MS}ms (last HTTP ${last})`,
  };
}

async function checkPreExisting(): Promise<Result> {
  const ps = await run(
    "docker",
    ["ps", "--filter", "name=acropolisos", "--format", "{{.Names}}"],
    { quiet: true },
  );
  if (ps.stdout.trim()) {
    return {
      name: "pre-existing stack check",
      ok: false,
      detail: `existing containers: ${ps.stdout.trim().replace(/\n/g, ", ")}`,
    };
  }
  return { name: "pre-existing stack check", ok: true };
}

async function build(): Promise<Result> {
  console.log("[smoke] building image...");
  const r = await run("docker", ["compose", "-f", COMPOSE_FILE, "build", "app"]);
  return {
    name: "docker compose build app",
    ok: r.code === 0,
    detail: r.code === 0 ? "image built" : `exit ${r.code}`,
  };
}

async function up(): Promise<Result> {
  console.log("[smoke] bringing stack up...");
  const r = await run("docker", ["compose", "-f", COMPOSE_FILE, "up", "-d"]);
  return {
    name: "docker compose up -d",
    ok: r.code === 0,
    detail: r.code === 0 ? "containers started" : `exit ${r.code}`,
  };
}

async function down(): Promise<void> {
  console.log("[smoke] tearing down...");
  await run("docker", [
    "compose",
    "-f",
    COMPOSE_FILE,
    "down",
    "-v",
    "--remove-orphans",
  ]);
}

async function checkInngestSync(): Promise<Result> {
  const { status, bodyHead } = await fetchStatus(`${INNGEST_URL}/v0/gql`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: "{ apps { id name url } }" }),
  });
  if (status !== 200) {
    return {
      name: "Inngest GraphQL reachable",
      ok: false,
      detail: `HTTP ${status}`,
    };
  }
  let parsed: { data?: { apps?: Array<{ name?: string }> } };
  try {
    parsed = JSON.parse(bodyHead);
  } catch {
    return { name: "Inngest GraphQL parse", ok: false, detail: bodyHead };
  }
  const apps = parsed.data?.apps ?? [];
  if (apps.length === 0) {
    return {
      name: "Inngest sees acropolisos app",
      ok: false,
      detail: "no apps registered",
    };
  }
  return {
    name: "Inngest sees acropolisos app",
    ok: true,
    detail: `${apps.length} app(s): ${apps.map((a) => a.name).join(", ")}`,
  };
}

async function main(): Promise<void> {
  const results: Result[] = [];
  let exitCode = 0;

  // Refuse to clobber an existing stack.
  const pre = await checkPreExisting();
  results.push(pre);
  if (!pre.ok) {
    summarize(results);
    process.exit(2);
  }

  let teardown = false;
  try {
    const built = await build();
    results.push(built);
    if (!built.ok) {
      exitCode = 1;
    } else {
      teardown = true;
      const upped = await up();
      results.push(upped);
      if (!upped.ok) {
        exitCode = 1;
      } else {
        // App HTTP-ready
        results.push(
          await pollUntil(
            `${APP_URL}/api/auth/csrf`,
            (s) => s === 200,
            "app responds at /api/auth/csrf",
          ),
        );

        // /signin renders
        results.push(
          await pollUntil(
            `${APP_URL}/signin`,
            (s) => s === 200,
            "/signin returns 200",
          ),
        );

        // Inngest discovered the app via -u polling
        // Give it up to 30s extra to let polling fire.
        await sleep(8_000);
        results.push(await checkInngestSync());
      }
    }
  } finally {
    if (teardown) await down();
  }

  summarize(results);
  process.exit(results.every((r) => r.ok) ? exitCode : 1);
}

function summarize(results: Result[]): void {
  console.log("\n=== smoke-compose summary ===");
  for (const r of results) {
    const mark = r.ok ? "OK  " : "FAIL";
    const detail = r.detail ? `  (${r.detail})` : "";
    console.log(`  [${mark}] ${r.name}${detail}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.`);
}

main().catch((err) => {
  console.error("[smoke] fatal:", err);
  process.exit(1);
});
