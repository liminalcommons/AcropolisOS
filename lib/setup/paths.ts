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

// The runtime, MUTABLE loaded-ontology dir. First-run setup copies a chosen
// scenario's ontology INTO here; the running app and the proposal pipeline
// read and mutate it. Distinct from scenarios/<name>/ontology (the read-only
// templates) — scenario discovery + path helpers live in ./scenarios.
export function getRuntimeOntologyDir(): string {
  return (
    process.env.ACROPOLISOS_ONTOLOGY_DIR ?? path.join(PKG_ROOT, "ontology")
  );
}
