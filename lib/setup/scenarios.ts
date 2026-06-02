// Scenario manifest (scenario.json) — the §3/§13 manifest fields:
// name, description, default(bool), version. A scenario bundle is
// scenarios/<name>/{ontology,seed,views}/ + this manifest.
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

// Package root — mirrors lib/setup/paths.ts. Turbopack rewrites __dirname to
// "/ROOT" in the server bundle, so resolve from cwd (the package root).
const PKG_ROOT = process.env.ACROPOLISOS_PKG_ROOT ?? process.cwd();

// The scenarios/ bundle root. scenarios/<name>/{ontology,seed,views} live here.
export function getScenariosRoot(): string {
  return (
    process.env.ACROPOLISOS_SCENARIOS_ROOT ?? path.join(PKG_ROOT, "scenarios")
  );
}

// The YAML model dir for a named scenario bundle (the read-only template).
export function scenarioOntologyDir(name: string): string {
  return path.join(getScenariosRoot(), name, "ontology");
}

// The sample-data dir for a named scenario bundle.
export function scenarioSeedDir(name: string): string {
  return path.join(getScenariosRoot(), name, "seed");
}

export const ScenarioManifest = z
  .object({
    name: z.string().min(1),
    description: z.string(),
    default: z.boolean().default(false),
    version: z.string().min(1),
  })
  .strict();
export type ScenarioManifest = z.infer<typeof ScenarioManifest>;

export function parseScenarioManifest(raw: unknown): ScenarioManifest {
  return ScenarioManifest.parse(raw);
}

// A scenario bundle discovered on disk: its manifest plus the conventional
// sub-paths. ontologyDir holds the YAML model; seedDir holds sample-data rows;
// viewsDir holds optional approved-view config descriptors (never TSX).
export interface DiscoveredScenario {
  manifest: ScenarioManifest;
  dir: string;
  ontologyDir: string;
  seedDir: string;
  viewsDir: string;
}

// Enumerate scenario bundles under `scenariosRoot`. A directory is a bundle iff
// it carries a scenario.json manifest; directories without one (and stray files
// like the top-level README.md) are skipped. Returns name-sorted. A missing
// scenarios root yields [] (cold-start tolerance), mirroring loadOntology.
export async function discoverScenarios(
  scenariosRoot: string,
): Promise<DiscoveredScenario[]> {
  let entries: string[];
  try {
    entries = await readdir(scenariosRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }

  const found: DiscoveredScenario[] = [];
  for (const entry of entries) {
    const dir = path.join(scenariosRoot, entry);
    let isDir = false;
    try {
      isDir = (await stat(dir)).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;

    const manifestPath = path.join(dir, "scenario.json");
    let raw: string;
    try {
      raw = await readFile(manifestPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }

    // Cold-start hardening: a single malformed manifest (invalid JSON or a
    // schema violation) must NOT take down discovery for every other bundle —
    // /setup needs to list the good ones. Skip the bad bundle, keep going.
    let manifest: ScenarioManifest;
    try {
      manifest = parseScenarioManifest(JSON.parse(raw));
    } catch (err) {
      console.error(
        `[scenarios] skipping malformed bundle at ${manifestPath}:`,
        err instanceof Error ? err.message : err,
      );
      continue;
    }

    found.push({
      manifest,
      dir,
      ontologyDir: path.join(dir, "ontology"),
      seedDir: path.join(dir, "seed"),
      viewsDir: path.join(dir, "views"),
    });
  }

  found.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
  return found;
}

// The scenario marked default (or the first by name if none is) — drives
// first-run setup. Returns undefined only when no bundle exists.
export async function getDefaultScenario(
  scenariosRoot: string = getScenariosRoot(),
): Promise<DiscoveredScenario | undefined> {
  const all = await discoverScenarios(scenariosRoot);
  return all.find((s) => s.manifest.default) ?? all[0];
}
