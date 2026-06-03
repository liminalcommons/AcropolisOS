import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// The five install-manifest files that describe how acropolisOS boots on a
// single host. They live at the host PACKAGE ROOT (one dir above lib/). They are
// NOT baked into the runtime image (the Dockerfile runner stage COPYs only the
// source dirs — app/, components/, lib/, functions/, scripts/, drizzle/,
// scenarios/ — and routes docker-entrypoint.sh to /usr/local/bin), and the
// ORIGINAL app-service volume list did not bind-mount them either.
//
// docker-compose.yml now bind-mounts all five read-only into /app so the
// in-container install suite is reproducible after any `compose up`. For an
// already-running container that was created BEFORE that mount existed, the
// operator must provision them with a one-off docker cp (see PROVISION_HINT).
export const INSTALL_MANIFEST_FILES = [
  "docker-compose.yml",
  "Dockerfile",
  "docker-entrypoint.sh",
  ".dockerignore",
  ".env.example",
] as const;

export type InstallManifestFile = (typeof INSTALL_MANIFEST_FILES)[number];

// lib/install/manifest-paths.ts -> lib/install -> lib -> package root.
export const PKG_ROOT = path.resolve(__dirname, "..", "..");

const PROVISION_HINT =
  "docker compose up -d (recreates the app container WITH the manifest bind-mounts) " +
  "or, for an already-running container, provision once with: " +
  "docker cp <file> acropolisos-app:/app/<file>";

export function manifestPath(name: string): string {
  return path.join(PKG_ROOT, name);
}

// Read an install-manifest file. On a missing file we throw ONE actionable
// error that names the provisioning route instead of letting a raw ENOENT
// bubble up — a bare ENOENT misled the previous reviewer into thinking the
// suite was reproducibly green when it only passed after a transient docker cp.
export function readManifest(name: string): string {
  const p = manifestPath(name);
  if (!existsSync(p)) {
    throw new Error(
      `install manifest "${name}" not found at ${p}. The five install-manifest ` +
        `files are not baked into the image and must be bind-mounted into /app. ` +
        `Provision them: ${PROVISION_HINT}`,
    );
  }
  return readFileSync(p, "utf8");
}

export function manifestExists(name: string): boolean {
  return existsSync(manifestPath(name));
}
