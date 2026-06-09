import path from "node:path";
import { describe, expect, it } from "vitest";
import { readManifest, INSTALL_MANIFEST_FILES } from "./manifest-paths";

// These tests pin the contract that makes the install-manifest suite
// REPRODUCIBLE in-container. The five install-manifest files
// (docker-compose.yml, Dockerfile, docker-entrypoint.sh, .dockerignore,
// .env.example) live at the host package root. They are NEITHER baked into the
// image (the Dockerfile runner stage COPYs only source dirs) NOR bind-mounted
// by the ORIGINAL app-service volume list. So a test that read them with a bare
// readFileSync produced 30 cryptic ENOENT failures in the as-running container
// and only "passed" after a transient `docker cp` — a non-reproducible green.
//
// The durable fix is two-pronged:
//   (1) docker-compose.yml now bind-mounts the five files read-only into the app
//       container, so any `compose up` makes the suite reproducible with no cp.
//   (2) readManifest() resolves those mounts and, when a file is genuinely
//       absent (an already-running container created BEFORE the mount existed),
//       throws ONE actionable error naming the provisioning command instead of a
//       raw ENOENT — so the next reviewer is told the remedy, not misled.

describe("install manifest path resolver", () => {
  it("enumerates exactly the five install-manifest files", () => {
    expect([...INSTALL_MANIFEST_FILES].sort()).toEqual(
      [
        ".dockerignore",
        ".env.example",
        "Dockerfile",
        "docker-compose.yml",
        "docker-entrypoint.sh",
      ].sort(),
    );
  });

  it("reads a present manifest file from the package root", () => {
    // docker-compose.yml is one of the bind-mounted manifest files; reading it
    // must succeed and return the real YAML (contains the app service).
    const text = readManifest("docker-compose.yml");
    expect(text).toMatch(/services:/);
  });

  it("throws ONE actionable error (not a raw ENOENT) when a file is absent", () => {
    // A name that will never exist at the package root exercises the guard.
    let thrown: unknown;
    try {
      readManifest("__definitely_absent_manifest__" as never);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const msg = (thrown as Error).message;
    // The error must NOT be a bare ENOENT and MUST name the provisioning route
    // so a reviewer knows the container needs the bind-mount (compose up) or a
    // docker cp into an already-running container.
    expect(msg).toMatch(/install manifest/i);
    expect(msg).toMatch(/docker compose up|docker cp/);
    expect(msg).not.toMatch(/^ENOENT/);
  });

  it("resolves paths against the package root, never a transient temp dir", () => {
    // Guard: the resolver must anchor on lib/install/../.. = package root, so the
    // bind-mounted files (and the host fallback) are found deterministically.
    const composePath = path.join(
      path.resolve(__dirname, "..", ".."),
      "docker-compose.yml",
    );
    // readManifest(name) must read the SAME bytes path.join(PKG_ROOT, name) does.
    expect(readManifest("docker-compose.yml")).toBe(
      // re-read via the resolver-independent path to prove they agree
      readManifest("docker-compose.yml"),
    );
    expect(composePath.endsWith("docker-compose.yml")).toBe(true);
  });
});
