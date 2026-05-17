import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const COMPOSE_PATH = path.join(PKG_ROOT, "docker-compose.yml");
const DOCKERFILE_PATH = path.join(PKG_ROOT, "Dockerfile");
const ENTRYPOINT_PATH = path.join(PKG_ROOT, "docker-entrypoint.sh");
const DOCKERIGNORE_PATH = path.join(PKG_ROOT, ".dockerignore");

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
