import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { RoleDefinition } from "./schema";

const BUILT_IN_ROLES = new Set(["member", "steward"]);
const RolesFile = z.record(z.string(), RoleDefinition);

export async function loadCustomRoleNames(
  ontologyDir: string,
): Promise<string[]> {
  const file = path.join(ontologyDir, "roles.yaml");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const parsed = RolesFile.parse(parseYaml(raw) ?? {});
  return Object.keys(parsed)
    .filter((name) => !BUILT_IN_ROLES.has(name))
    .sort();
}
