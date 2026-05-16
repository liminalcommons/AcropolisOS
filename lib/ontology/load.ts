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
  type PropertyDefinition,
} from "./schema";

const BUILTIN_PERMISSION_TOKENS = new Set(["*", "member_self"]);

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
  const parsed = Ontology.parse(aggregate);
  assertOntologyIntegrity(parsed);
  return parsed;
}

function isRefProp(
  prop: PropertyDefinition,
): prop is Extract<PropertyDefinition, { ref: string }> {
  return "ref" in prop;
}

export class OntologyIntegrityError extends Error {
  constructor(
    readonly violations: { pointer: string; message: string }[],
  ) {
    super(
      "ontology integrity check failed:\n" +
        violations.map((v) => `  - ${v.pointer}: ${v.message}`).join("\n"),
    );
    this.name = "OntologyIntegrityError";
  }
}

export function assertOntologyIntegrity(ontology: OntologyType): void {
  const violations: { pointer: string; message: string }[] = [];
  const knownRoles = new Set([
    "member",
    "steward",
    ...Object.keys(ontology.roles),
  ]);
  const knownObjectTypes = new Set(Object.keys(ontology.object_types));
  const knownLinkTypes = new Set(Object.keys(ontology.link_types));
  const knownProperties = new Set(Object.keys(ontology.properties));

  const checkPermissionTokens = (pointer: string, tokens: string[]) => {
    for (const tok of tokens) {
      if (BUILTIN_PERMISSION_TOKENS.has(tok)) continue;
      if (!knownRoles.has(tok)) {
        violations.push({
          pointer,
          message: `unknown role/token "${tok}"`,
        });
      }
    }
  };

  const checkPropertyMap = (
    pointer: string,
    props: Record<string, PropertyDefinition>,
  ) => {
    for (const [name, prop] of Object.entries(props)) {
      if (isRefProp(prop)) {
        if (!knownProperties.has(prop.ref)) {
          violations.push({
            pointer: `${pointer}/${name}`,
            message: `ref "${prop.ref}" does not resolve to a shared property`,
          });
        }
        continue;
      }
      if (prop.type === "ref") {
        if (!knownObjectTypes.has(prop.target)) {
          violations.push({
            pointer: `${pointer}/${name}`,
            message: `target "${prop.target}" does not resolve to an object type`,
          });
        }
      }
      if (prop.permissions) {
        if (prop.permissions.read) {
          checkPermissionTokens(
            `${pointer}/${name}/permissions/read`,
            prop.permissions.read,
          );
        }
        if (prop.permissions.write) {
          checkPermissionTokens(
            `${pointer}/${name}/permissions/write`,
            prop.permissions.write,
          );
        }
      }
    }
  };

  for (const [name, ot] of Object.entries(ontology.object_types)) {
    const base = `/object_types/${name}`;
    if (ot.permissions?.read) {
      checkPermissionTokens(`${base}/permissions/read`, ot.permissions.read);
    }
    if (ot.permissions?.write) {
      checkPermissionTokens(`${base}/permissions/write`, ot.permissions.write);
    }
    checkPropertyMap(`${base}/properties`, ot.properties);
    if (ot.title_property && !(ot.title_property in ot.properties)) {
      violations.push({
        pointer: `${base}/title_property`,
        message: `title_property "${ot.title_property}" is not a declared property`,
      });
    }
  }

  for (const [name, lt] of Object.entries(ontology.link_types)) {
    const base = `/link_types/${name}`;
    if (!knownObjectTypes.has(lt.from)) {
      violations.push({
        pointer: `${base}/from`,
        message: `from "${lt.from}" does not resolve to an object type`,
      });
    }
    if (!knownObjectTypes.has(lt.to)) {
      violations.push({
        pointer: `${base}/to`,
        message: `to "${lt.to}" does not resolve to an object type`,
      });
    }
    if (lt.properties) {
      checkPropertyMap(`${base}/properties`, lt.properties);
    }
  }

  for (const [name, at] of Object.entries(ontology.action_types)) {
    const base = `/action_types/${name}`;
    if (at.creates_link && !knownLinkTypes.has(at.creates_link)) {
      violations.push({
        pointer: `${base}/creates_link`,
        message: `creates_link "${at.creates_link}" does not resolve to a link type`,
      });
    }
    if (at.creates_object && !knownObjectTypes.has(at.creates_object)) {
      violations.push({
        pointer: `${base}/creates_object`,
        message: `creates_object "${at.creates_object}" does not resolve to an object type`,
      });
    }
    if (at.parameters) {
      checkPropertyMap(`${base}/parameters`, at.parameters);
    }
    if (at.permissions) {
      checkPermissionTokens(`${base}/permissions`, at.permissions);
    }
  }

  if (violations.length > 0) {
    throw new OntologyIntegrityError(violations);
  }
}
