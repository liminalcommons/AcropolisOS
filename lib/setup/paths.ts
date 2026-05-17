import path from "node:path";

// Turbopack replaces `__dirname` with the literal placeholder "/ROOT" in
// the server bundle, which breaks `path.resolve(__dirname, "..", "..")` at
// runtime (yields "/ROOT" — a directory the container can't mkdir into).
// Use `process.cwd()` instead — the Docker image WORKDIR is the package
// root, and `npm run dev` is invoked from there too.
const PKG_ROOT = process.env.ACROPOLISOS_PKG_ROOT ?? process.cwd();

export function getEnvFile(): string {
  return process.env.ACROPOLISOS_ENV_FILE ?? path.join(PKG_ROOT, ".env");
}

export function getSeedRoot(): string {
  return process.env.ACROPOLISOS_SEED_ROOT ?? path.join(PKG_ROOT, "seed");
}

export function getRuntimeOntologyDir(): string {
  return (
    process.env.ACROPOLISOS_ONTOLOGY_DIR ??
    path.join(PKG_ROOT, "ontology")
  );
}

export const SEED_NAMES = ["empty", "small-community"] as const;
export type SeedName = (typeof SEED_NAMES)[number];

export function isSeedName(v: string): v is SeedName {
  return (SEED_NAMES as readonly string[]).includes(v);
}
