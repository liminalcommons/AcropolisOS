import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  ActionType,
  LinkType,
  ObjectType,
  Ontology,
  RoleDefinition,
  SharedPropertyRegistry,
  type Ontology as OntologyType,
} from "./schema";

export class OntologyValidationError extends Error {
  constructor(
    message: string,
    readonly file: string,
    readonly pointer: string,
    readonly issues: z.ZodIssue[],
  ) {
    super(
      `[${file}] ${pointer || "/"}: ${message}\n` +
        issues
          .map(
            (i) =>
              `  - /${i.path.map(String).join("/")}: ${i.message} (${i.code})`,
          )
          .join("\n"),
    );
    this.name = "OntologyValidationError";
  }
}

async function readYaml(filePath: string): Promise<unknown> {
  const raw = await readFile(filePath, "utf8");
  return parseYaml(raw);
}

function validate<T>(
  schema: z.ZodType<T>,
  value: unknown,
  file: string,
  pointer: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new OntologyValidationError(
      "validation failed",
      file,
      pointer,
      result.error.issues,
    );
  }
  return result.data;
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function loadDir<T>(
  dir: string,
  schema: z.ZodType<T>,
): Promise<Record<string, T>> {
  const files = (await safeReaddir(dir)).filter((f) => f.endsWith(".yaml"));
  const aggregate: Record<string, T> = {};
  for (const file of files) {
    const filePath = path.join(dir, file);
    const data = await readYaml(filePath);
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
      throw new OntologyValidationError(
        "expected mapping at file root",
        filePath,
        "",
        [],
      );
    }
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      aggregate[key] = validate(schema, value, filePath, `/${key}`);
    }
  }
  return aggregate;
}

export async function loadOntology(root: string): Promise<OntologyType> {
  const propertiesPath = path.join(root, "properties.yaml");
  const rolesPath = path.join(root, "roles.yaml");
  const linkTypesPath = path.join(root, "link-types.yaml");
  const objectTypesDir = path.join(root, "object-types");
  const actionTypesDir = path.join(root, "action-types");

  const propertiesRaw = await readYaml(propertiesPath).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  });
  const properties = validate(
    SharedPropertyRegistry,
    propertiesRaw ?? {},
    propertiesPath,
    "",
  );

  const rolesRaw = await readYaml(rolesPath).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  });
  const roles = validate(
    z.record(z.string(), RoleDefinition),
    rolesRaw ?? {},
    rolesPath,
    "",
  );

  const linkTypesRaw = await readYaml(linkTypesPath).catch((err) => {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  });
  const link_types = validate(
    z.record(z.string(), LinkType),
    linkTypesRaw ?? {},
    linkTypesPath,
    "",
  );

  const object_types = await loadDir(objectTypesDir, ObjectType);
  const action_types = await loadDir(actionTypesDir, ActionType);

  const aggregate = { properties, roles, object_types, link_types, action_types };
  return Ontology.parse(aggregate);
}
