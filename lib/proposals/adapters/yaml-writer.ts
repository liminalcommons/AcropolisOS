import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ProposalDiff } from "../diff";
import type { FileSnapshot, FileSnapshotEntry, YamlWriter } from "../apply";

function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function snapshotPath(
  filePath: string,
): Promise<FileSnapshotEntry> {
  return { path: filePath, previousContent: await readIfExists(filePath) };
}

async function writeStable(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function mergeMap(
  existing: string | null,
  additions: Record<string, unknown>,
): string {
  const base = existing ? (parseYaml(existing) as Record<string, unknown>) : {};
  const merged = { ...(base ?? {}), ...additions };
  return stringifyYaml(merged);
}

function singleEntryYaml(name: string, body: unknown): string {
  return stringifyYaml({ [name]: body });
}

export class FsYamlWriter implements YamlWriter {
  async writeUpdates(
    diff: ProposalDiff,
    ontologyRoot: string,
  ): Promise<FileSnapshot> {
    const entries: FileSnapshotEntry[] = [];

    // properties.yaml — merge new + modified
    const propertiesPath = path.join(ontologyRoot, "properties.yaml");
    const propertyAdditions: Record<string, unknown> = {
      ...diff.new_shared_properties,
      ...diff.modified_properties,
    };
    if (Object.keys(propertyAdditions).length > 0) {
      entries.push(await snapshotPath(propertiesPath));
      const current = await readIfExists(propertiesPath);
      await writeStable(
        propertiesPath,
        mergeMap(current, propertyAdditions),
      );
    }

    // link-types.yaml — merge
    const linkTypesPath = path.join(ontologyRoot, "link-types.yaml");
    if (Object.keys(diff.new_link_types).length > 0) {
      entries.push(await snapshotPath(linkTypesPath));
      const current = await readIfExists(linkTypesPath);
      await writeStable(
        linkTypesPath,
        mergeMap(current, diff.new_link_types),
      );
    }

    // object-types/<snake>.yaml — one file per new object type
    for (const [name, body] of Object.entries(diff.new_object_types)) {
      const file = path.join(
        ontologyRoot,
        "object-types",
        `${snakeCase(name)}.yaml`,
      );
      entries.push(await snapshotPath(file));
      await writeStable(file, singleEntryYaml(name, body));
    }

    // action-types/<snake>.yaml — one file per new action type
    for (const [name, body] of Object.entries(diff.new_action_types)) {
      const file = path.join(
        ontologyRoot,
        "action-types",
        `${snakeCase(name)}.yaml`,
      );
      entries.push(await snapshotPath(file));
      await writeStable(file, singleEntryYaml(name, body));
    }

    // functions/<filename> — verbatim TS body
    for (const [filename, body] of Object.entries(diff.new_functions)) {
      const file = path.join(ontologyRoot, "..", "functions", filename);
      entries.push(await snapshotPath(file));
      await writeStable(file, body.ts_body);
    }

    // views/<object_type>/<view>.tsx — verbatim TSX body
    for (const view of Object.values(diff.new_views)) {
      const file = path.join(
        ontologyRoot,
        "..",
        "views",
        view.object_type,
        `${view.view}.tsx`,
      );
      entries.push(await snapshotPath(file));
      await writeStable(file, view.tsx_body);
    }

    // seeds/<object_type>.jsonl — verbatim
    for (const seed of Object.values(diff.new_seeds)) {
      const file = path.join(
        ontologyRoot,
        "..",
        "seeds",
        `${seed.object_type}.jsonl`,
      );
      entries.push(await snapshotPath(file));
      await writeStable(file, seed.rows_jsonl);
    }

    // ingests/<name>.yaml — config
    for (const [name, ingest] of Object.entries(diff.new_ingests)) {
      const file = path.join(
        ontologyRoot,
        "..",
        "ingests",
        `${snakeCase(name)}.yaml`,
      );
      entries.push(await snapshotPath(file));
      await writeStable(file, stringifyYaml(ingest));
    }

    return { files: entries };
  }

  async restore(snapshot: FileSnapshot): Promise<void> {
    for (const entry of snapshot.files) {
      if (entry.previousContent === null) {
        await rm(entry.path, { force: true });
      } else {
        await writeStable(entry.path, entry.previousContent);
      }
    }
  }
}
