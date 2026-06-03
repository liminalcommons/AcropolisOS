import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const COMPOSE_PATH = path.join(PKG_ROOT, "docker-compose.yml");
const DOCKERFILE_PATH = path.join(PKG_ROOT, "Dockerfile");
const ENTRYPOINT_PATH = path.join(PKG_ROOT, "docker-entrypoint.sh");
const DOCKERIGNORE_PATH = path.join(PKG_ROOT, ".dockerignore");
const ENV_EXAMPLE_PATH = path.join(PKG_ROOT, ".env.example");

interface ComposeService {
  image?: string;
  build?: unknown;
  ports?: string[];
  volumes?: string[];
  command?: string | string[];
  depends_on?: Record<string, { condition?: string }> | string[];
  healthcheck?: { test: unknown };
  environment?: Record<string, string> | string[];
  env_file?: string | string[];
  restart?: string;
}

interface ComposeShape {
  services: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
}

function loadCompose(): ComposeShape {
  return parseYaml(readFileSync(COMPOSE_PATH, "utf8")) as ComposeShape;
}

// docker-compose `environment:` accepts BOTH a map ({KEY: val}) and a list
// (["KEY=val"]). Flatten either form to a single string so a test can grep for
// a key=value pair without caring which form the author used.
function flatEnv(env: Record<string, string> | string[] | undefined): string {
  if (!env) return "";
  if (Array.isArray(env)) return env.join("\n");
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
}

describe("docker-compose.yml — US-036 single-host install", () => {
  it("exists at package root", () => {
    expect(existsSync(COMPOSE_PATH)).toBe(true);
  });

  it("declares postgres, app, and inngest services", () => {
    const compose = loadCompose();
    expect(compose.services.postgres).toBeDefined();
    expect(compose.services.app).toBeDefined();
    expect(compose.services.inngest).toBeDefined();
  });

  it("app service builds from local Dockerfile", () => {
    const compose = loadCompose();
    expect(compose.services.app.build).toBeDefined();
  });

  it("app exposes port 3030 (matches package.json next start --port 3030)", () => {
    const compose = loadCompose();
    const ports = compose.services.app.ports ?? [];
    expect(ports.some((p) => p.includes("3030"))).toBe(true);
  });

  it("app mounts ./ontology, ./functions, ./uploads, ./.env per AC", () => {
    const compose = loadCompose();
    const volumes = compose.services.app.volumes ?? [];
    const flat = volumes.join("\n");
    expect(flat).toMatch(/\.\/ontology/);
    expect(flat).toMatch(/\.\/functions/);
    expect(flat).toMatch(/\.\/uploads/);
    expect(flat).toMatch(/\.\/\.env/);
  });

  it("app waits for postgres to be healthy before starting", () => {
    const compose = loadCompose();
    const dep = compose.services.app.depends_on;
    if (!dep || Array.isArray(dep)) {
      throw new Error("app.depends_on must be the object form with a condition");
    }
    expect(dep.postgres?.condition).toBe("service_healthy");
  });

  it("postgres defines a healthcheck", () => {
    const compose = loadCompose();
    expect(compose.services.postgres.healthcheck).toBeDefined();
  });

  it("postgres persists data via a named volume", () => {
    const compose = loadCompose();
    const volumes = compose.services.postgres.volumes ?? [];
    expect(volumes.some((v) => v.includes("/var/lib/postgresql/data"))).toBe(
      true,
    );
  });

  it("inngest dev server points at the app's /api/inngest", () => {
    const compose = loadCompose();
    const cmd = compose.services.inngest.command;
    const flat = Array.isArray(cmd) ? cmd.join(" ") : (cmd ?? "");
    expect(flat).toMatch(/app:3030\/api\/inngest/);
  });

  it("inngest exposes its dashboard port", () => {
    const compose = loadCompose();
    const ports = compose.services.inngest.ports ?? [];
    expect(ports.length).toBeGreaterThan(0);
  });
});

describe("Dockerfile — US-036 reproducible image", () => {
  it("exists at package root", () => {
    expect(existsSync(DOCKERFILE_PATH)).toBe(true);
  });

  it("uses a Node.js LTS base image", () => {
    const dockerfile = readFileSync(DOCKERFILE_PATH, "utf8");
    expect(dockerfile).toMatch(/FROM node:/);
  });

  it("runs the Next.js production build", () => {
    const dockerfile = readFileSync(DOCKERFILE_PATH, "utf8");
    expect(dockerfile).toMatch(/npm run build/);
  });

  it("invokes the entrypoint so first boot runs migrations", () => {
    const dockerfile = readFileSync(DOCKERFILE_PATH, "utf8");
    expect(dockerfile).toMatch(/docker-entrypoint\.sh/);
  });
});

describe("docker-entrypoint.sh — first-boot schema sync", () => {
  it("exists", () => {
    expect(existsSync(ENTRYPOINT_PATH)).toBe(true);
  });

  it("runs drizzle-kit push before starting the app", () => {
    // Changed from `drizzle-kit migrate` in commit 8857ec873 — the hand-
    // written SQL migrations in drizzle/ don't include CREATE TABLE for
    // the codegen'd object tables, so `migrate` always failed at
    // 0003_data_audit. `push --force` syncs the full Drizzle schema
    // (incl. the re-exported schema.generated) idempotently.
    const entrypoint = readFileSync(ENTRYPOINT_PATH, "utf8");
    expect(entrypoint).toMatch(/drizzle-kit push --force/);
    expect(entrypoint).toMatch(/exec/);
  });

  it("applies 0003_data_audit.sql via psql after push (B9 regression guard)", () => {
    // drizzle-kit push doesn't run the hand-written SQL migrations, so the
    // member_data_audit_trg trigger from drizzle/0003_data_audit.sql was
    // silently never applied after we switched to push. Re-running 0003
    // explicitly via psql after push is the pragmatic fix; 0003 itself is
    // idempotent (CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION,
    // DROP TRIGGER IF EXISTS).
    const entrypoint = readFileSync(ENTRYPOINT_PATH, "utf8");
    expect(entrypoint).toMatch(/psql .*0003_data_audit\.sql/);
    expect(entrypoint).toMatch(/ON_ERROR_STOP=1/);
  });
});

describe("scripts/smoke-compose.ts — I3 boot smoke", () => {
  const SMOKE_PATH = path.join(PKG_ROOT, "scripts", "smoke-compose.ts");
  const PACKAGE_JSON_PATH = path.join(PKG_ROOT, "package.json");

  it("exists", () => {
    expect(existsSync(SMOKE_PATH)).toBe(true);
  });

  it("is wired to the test:compose npm script", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.["test:compose"]).toBeDefined();
    expect(pkg.scripts?.["test:compose"]).toMatch(/smoke-compose/);
  });

  it("asserts the four signals that catch the original launch bugs", () => {
    // Guard against the script being silently stripped down — it must
    // probe the four boot signals that the unit suite missed:
    //   1. /api/auth/csrf (Edge runtime / middleware / migrations)
    //   2. /signin (missing-page regressions)
    //   3. Inngest GraphQL (action discovery)
    //   4. docker compose build/up succeeds (Dockerfile / compose syntax)
    const script = readFileSync(SMOKE_PATH, "utf8");
    expect(script).toMatch(/\/api\/auth\/csrf/);
    expect(script).toMatch(/\/signin/);
    expect(script).toMatch(/Inngest GraphQL|\/v0\/gql/);
    expect(script).toMatch(/docker compose build|"build"/);
  });

  it("allows >=60s for cold-machine boot (image pull + schema push + inngest sync)", () => {
    // On a clean checkout the first `docker compose up` pulls postgres + inngest
    // images, runs drizzle-kit push, and waits for inngest's polling sync.
    // 60s is the lower bound observed on chora-node; tightening below this
    // produces flaky CI failures that don't reproduce locally. If a future
    // change reduces the timeout, this test forces an explicit decision.
    const script = readFileSync(SMOKE_PATH, "utf8");
    const match = script.match(/BOOT_TIMEOUT_MS\s*=\s*([\d_]+)/);
    expect(match, "BOOT_TIMEOUT_MS constant must be defined").not.toBeNull();
    const ms = Number(match![1].replace(/_/g, ""));
    expect(ms).toBeGreaterThanOrEqual(60_000);
  });

  it("polls at <=5s intervals so a 60s boot isn't wasted on stale checks", () => {
    const script = readFileSync(SMOKE_PATH, "utf8");
    const match = script.match(/POLL_INTERVAL_MS\s*=\s*([\d_]+)/);
    expect(match, "POLL_INTERVAL_MS constant must be defined").not.toBeNull();
    const ms = Number(match![1].replace(/_/g, ""));
    expect(ms).toBeGreaterThan(0);
    expect(ms).toBeLessThanOrEqual(5_000);
  });

  it("refuses to clobber an existing stack and exits 2", () => {
    // Operator-safety: running test:compose on a host with a live acropolisos
    // stack must NOT tear it down. The script checks `docker ps --filter
    // name=acropolisos` and exits 2 (distinct from 1 = check-failed) so CI
    // can flag "wrong environment" vs "real regression".
    const script = readFileSync(SMOKE_PATH, "utf8");
    expect(script).toMatch(/docker.*ps.*--filter.*acropolisos/s);
    expect(script).toMatch(/process\.exit\(2\)/);
  });

  it("tears down with -v in a finally block so volumes never leak between runs", () => {
    // Without `down -v` the named pgdata volume survives, so a second smoke
    // run hits stale schema and skips first-boot migration paths — exactly
    // the case clean-machine smoke is supposed to catch.
    const script = readFileSync(SMOKE_PATH, "utf8");
    expect(script).toMatch(/down["',\s]+["']-v/);
    expect(script).toMatch(/finally\s*\{[\s\S]*?down\(/);
  });
});

describe(".dockerignore — reproducible builds", () => {
  it("exists at package root", () => {
    expect(existsSync(DOCKERIGNORE_PATH)).toBe(true);
  });

  it("excludes node_modules and .next so build context stays small", () => {
    const ignore = readFileSync(DOCKERIGNORE_PATH, "utf8");
    expect(ignore).toMatch(/node_modules/);
    expect(ignore).toMatch(/\.next/);
  });
});

describe("docker-compose.yml — Discord Gateway worker service (Phase E3)", () => {
  const SVC = "acropolisos-discord-gateway";

  it("declares the acropolisos-discord-gateway service", () => {
    const compose = loadCompose();
    expect(compose.services[SVC]).toBeDefined();
  });

  it("shares the app's build/image so discord.js + tsx are already installed", () => {
    // Reuse the same Node image (build context) the app uses — discord.js is a
    // prod dependency and tsx is a devDependency already present in the image.
    // A separate Dockerfile would duplicate the dependency tree.
    const compose = loadCompose();
    expect(compose.services[SVC].build).toBeDefined();
  });

  it("restarts unless-stopped (always-on worker)", () => {
    const compose = loadCompose();
    expect(compose.services[SVC].restart).toBe("unless-stopped");
  });

  it("shares the database via the same DATABASE_URL the app uses", () => {
    // The worker writes raw_inbox + channel_bindings on the SAME Postgres the
    // app reads. It must reach postgres:5432 over the internal Docker network.
    const compose = loadCompose();
    const env = flatEnv(compose.services[SVC].environment);
    expect(env).toMatch(/DATABASE_URL=postgres:\/\/.*@postgres:5432\/acropolisos/);
  });

  it("loads .env (env_file) so DISCORD_BOT_TOKEN comes from the gitignored file ONLY", () => {
    // The token is read from process.env at runtime. It is supplied ONLY via the
    // gitignored .env (env_file) — NEVER hardcoded in the compose environment.
    const compose = loadCompose();
    const envFile = compose.services[SVC].env_file;
    const files = Array.isArray(envFile) ? envFile : envFile ? [envFile] : [];
    expect(files.some((f) => f.includes(".env"))).toBe(true);
  });

  it("runs the discord-gateway worker entry via tsx with WORKER_ENTRY set", () => {
    // The worker's index.ts only calls main() when WORKER_ENTRY=discord-gateway
    // (so a plain import under vitest/tsc stays side-effect-free). The command
    // runs it with tsx, which resolves the @/ tsconfig path alias in-container.
    const compose = loadCompose();
    const cmd = compose.services[SVC].command;
    const flat = Array.isArray(cmd) ? cmd.join(" ") : (cmd ?? "");
    expect(flat).toMatch(/tsx/);
    expect(flat).toMatch(/workers\/discord-gateway\/index\.ts/);
    const env = flatEnv(compose.services[SVC].environment);
    expect(env).toMatch(/WORKER_ENTRY=discord-gateway/);
  });

  it("waits for postgres to be healthy before connecting", () => {
    const compose = loadCompose();
    const dep = compose.services[SVC].depends_on;
    if (!dep || Array.isArray(dep)) {
      throw new Error(`${SVC}.depends_on must be the object form with a condition`);
    }
    expect(dep.postgres?.condition).toBe("service_healthy");
  });

  it("bind-mounts the source the worker imports (workers/, lib/, tsconfig.json)", () => {
    // Dev compose runs from source via tsx, so the worker + its @/lib imports +
    // the path-alias tsconfig must be mounted into the container.
    const compose = loadCompose();
    const volumes = compose.services[SVC].volumes ?? [];
    const flat = volumes.join("\n");
    expect(flat).toMatch(/\.\/workers/);
    expect(flat).toMatch(/\.\/lib/);
    expect(flat).toMatch(/tsconfig\.json/);
  });

  it("hardcodes NO Discord bot token anywhere in the service (inert when unset)", () => {
    // Security fence: the compose service must contain no literal token. The only
    // token crossing is the gitignored .env (env_file). When unset the worker
    // logs "idle" and does not crash (asserted by the worker unit tests).
    const compose = loadCompose();
    const svcText = JSON.stringify(compose.services[SVC]);
    // A real Discord bot token is a long opaque string; ensure DISCORD_BOT_TOKEN
    // is never assigned an inline value in the compose service.
    expect(svcText).not.toMatch(/DISCORD_BOT_TOKEN=\S/);
  });
});

describe(".env.example — DISCORD_BOT_TOKEN placeholder (Phase E3)", () => {
  it("declares an EMPTY DISCORD_BOT_TOKEN placeholder (no real token committed)", () => {
    const env = readFileSync(ENV_EXAMPLE_PATH, "utf8");
    // The line must exist and be empty (key with no value). A non-empty value
    // would mean a token leaked into a tracked file.
    expect(env).toMatch(/^DISCORD_BOT_TOKEN=\s*$/m);
  });

  it("documents the manual token-reset + MESSAGE_CONTENT intent steps", () => {
    const env = readFileSync(ENV_EXAMPLE_PATH, "utf8");
    expect(env).toMatch(/MESSAGE_CONTENT/);
  });
});
