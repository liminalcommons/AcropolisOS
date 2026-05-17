import path from "node:path";

const PKG_ROOT = path.resolve(__dirname, "..", "..");

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
