import { z, type ZodTypeAny } from "zod";
import { createTool, type Tool } from "@mastra/core/tools";
import type { Ontology } from "../ontology/schema";
import { buildZodSchemas, pascalCase } from "./zod";

// Tool generics carry a precise input/output shape; `any` lets us collect
// heterogeneous tools into one record without losing runtime behaviour.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyMastraTool = Tool<any, any, any, any, any, string, any>;

export const READ_OPS = [
  "describe",
  "query",
  "traverse",
  "sample",
  "read",
  "audit",
] as const;
export type ReadOp = (typeof READ_OPS)[number];

export function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export function toolIdFor(op: ReadOp, objectType: string): string {
  return `${op}_${snakeCase(objectType)}`;
}

function notImplemented(toolId: string, story: string): () => Promise<never> {
  return async () => {
    throw new Error(`${toolId} not implemented (${story})`);
  };
}

function buildReadTool(
  op: ReadOp,
  objectName: string,
  objSchema: ZodTypeAny,
): AnyMastraTool {
  const id = toolIdFor(op, objectName);
  switch (op) {
    case "describe":
      return createTool({
        id,
        description: `Describe the ${objectName} object type (properties, links, permissions).`,
        inputSchema: z.object({}),
        outputSchema: z.object({
          name: z.string(),
          properties: z.record(z.string(), z.unknown()),
        }),
        execute: notImplemented(id, "US-014"),
      });
    case "query":
      return createTool({
        id,
        description: `Query ${objectName} records by an optional filter.`,
        inputSchema: z.object({
          filter: z.record(z.string(), z.unknown()).optional(),
          limit: z.number().int().positive().max(1000).optional(),
        }),
        outputSchema: z.object({ results: z.array(objSchema) }),
        execute: notImplemented(id, "US-014"),
      });
    case "traverse":
      return createTool({
        id,
        description: `Traverse links from a ${objectName} record.`,
        inputSchema: z.object({
          id: z.string(),
          link: z.string().optional(),
        }),
        outputSchema: z.object({ linked: z.array(z.unknown()) }),
        execute: notImplemented(id, "US-014"),
      });
    case "sample":
      return createTool({
        id,
        description: `Return up to N representative ${objectName} records.`,
        inputSchema: z.object({
          n: z.number().int().positive().max(100).default(5),
        }),
        outputSchema: z.object({ samples: z.array(objSchema) }),
        execute: notImplemented(id, "US-014"),
      });
    case "read":
      return createTool({
        id,
        description: `Read a single ${objectName} record by id.`,
        inputSchema: z.object({ id: z.string() }),
        outputSchema: z.object({ record: objSchema.nullable() }),
        execute: notImplemented(id, "US-014"),
      });
    case "audit":
      return createTool({
        id,
        description: `Return recent audit entries scoped to ${objectName}.`,
        inputSchema: z.object({
          id: z.string().optional(),
          since: z.iso.datetime({ offset: true }).optional(),
          limit: z.number().int().positive().max(1000).optional(),
        }),
        outputSchema: z.object({ entries: z.array(z.unknown()) }),
        execute: notImplemented(id, "US-014"),
      });
  }
}

export interface BuiltMastraTools {
  tools: Record<string, AnyMastraTool>;
  applyActionInput: ZodTypeAny;
}

export function buildMastraTools(ontology: Ontology): BuiltMastraTools {
  const { objectSchemas, actionParamSchemas } = buildZodSchemas(ontology);
  const tools: Record<string, AnyMastraTool> = {};

  for (const objName of Object.keys(ontology.object_types)) {
    const pascal = pascalCase(objName);
    const objSchema = objectSchemas[pascal];
    if (!objSchema) {
      throw new Error(`missing generated schema for object type ${pascal}`);
    }
    for (const op of READ_OPS) {
      tools[toolIdFor(op, pascal)] = buildReadTool(op, pascal, objSchema);
    }
  }

  const actionNames = Object.keys(ontology.action_types);
  if (actionNames.length === 0) {
    throw new Error(
      "ontology has zero action types — apply_action requires at least one branch",
    );
  }
  const actionBranches = actionNames.map((name) => {
    const paramSchemaName = `${pascalCase(name)}Params`;
    const paramSchema = actionParamSchemas[paramSchemaName];
    if (!paramSchema) {
      throw new Error(`missing param schema ${paramSchemaName}`);
    }
    return z.object({
      action: z.literal(name),
      params: paramSchema,
    });
  });
  const applyActionInput = z.discriminatedUnion(
    "action",
    actionBranches as [(typeof actionBranches)[number], ...typeof actionBranches],
  );

  tools.apply_action = createTool({
    id: "apply_action",
    description:
      "Apply a named action to mutate ontology state. Input is a discriminated union over the action types declared in the ontology.",
    inputSchema: applyActionInput,
    outputSchema: z.object({
      ok: z.boolean(),
      created: z
        .object({ object_type: z.string().optional(), id: z.string().optional() })
        .optional(),
    }),
    execute: notImplemented("apply_action", "US-027"),
  });

  return { tools, applyActionInput };
}

const HEADER = `// THIS FILE IS GENERATED. DO NOT EDIT.
// Source: lib/codegen/mastra-tools.ts — regenerate via the ontology codegen pipeline.

`;

function emitReadToolBlock(
  op: ReadOp,
  objectName: string,
  objectSchemaName: string,
): string {
  const id = toolIdFor(op, objectName);
  const constName = `${id}Tool`;
  const exec = `async () => { throw new Error(${JSON.stringify(
    `${id} not implemented (US-014)`,
  )}); }`;
  switch (op) {
    case "describe":
      return (
        `export const ${constName} = createTool({\n` +
        `  id: ${JSON.stringify(id)},\n` +
        `  description: ${JSON.stringify(
          `Describe the ${objectName} object type (properties, links, permissions).`,
        )},\n` +
        `  inputSchema: z.object({}),\n` +
        `  outputSchema: z.object({\n` +
        `    name: z.string(),\n` +
        `    properties: z.record(z.string(), z.unknown()),\n` +
        `  }),\n` +
        `  execute: ${exec},\n` +
        `});\n`
      );
    case "query":
      return (
        `export const ${constName} = createTool({\n` +
        `  id: ${JSON.stringify(id)},\n` +
        `  description: ${JSON.stringify(
          `Query ${objectName} records by an optional filter.`,
        )},\n` +
        `  inputSchema: z.object({\n` +
        `    filter: z.record(z.string(), z.unknown()).optional(),\n` +
        `    limit: z.number().int().positive().max(1000).optional(),\n` +
        `  }),\n` +
        `  outputSchema: z.object({ results: z.array(${objectSchemaName}) }),\n` +
        `  execute: ${exec},\n` +
        `});\n`
      );
    case "traverse":
      return (
        `export const ${constName} = createTool({\n` +
        `  id: ${JSON.stringify(id)},\n` +
        `  description: ${JSON.stringify(
          `Traverse links from a ${objectName} record.`,
        )},\n` +
        `  inputSchema: z.object({\n` +
        `    id: z.string(),\n` +
        `    link: z.string().optional(),\n` +
        `  }),\n` +
        `  outputSchema: z.object({ linked: z.array(z.unknown()) }),\n` +
        `  execute: ${exec},\n` +
        `});\n`
      );
    case "sample":
      return (
        `export const ${constName} = createTool({\n` +
        `  id: ${JSON.stringify(id)},\n` +
        `  description: ${JSON.stringify(
          `Return up to N representative ${objectName} records.`,
        )},\n` +
        `  inputSchema: z.object({\n` +
        `    n: z.number().int().positive().max(100).default(5),\n` +
        `  }),\n` +
        `  outputSchema: z.object({ samples: z.array(${objectSchemaName}) }),\n` +
        `  execute: ${exec},\n` +
        `});\n`
      );
    case "read":
      return (
        `export const ${constName} = createTool({\n` +
        `  id: ${JSON.stringify(id)},\n` +
        `  description: ${JSON.stringify(
          `Read a single ${objectName} record by id.`,
        )},\n` +
        `  inputSchema: z.object({ id: z.string() }),\n` +
        `  outputSchema: z.object({ record: ${objectSchemaName}.nullable() }),\n` +
        `  execute: ${exec},\n` +
        `});\n`
      );
    case "audit":
      return (
        `export const ${constName} = createTool({\n` +
        `  id: ${JSON.stringify(id)},\n` +
        `  description: ${JSON.stringify(
          `Return recent audit entries scoped to ${objectName}.`,
        )},\n` +
        `  inputSchema: z.object({\n` +
        `    id: z.string().optional(),\n` +
        `    since: z.iso.datetime({ offset: true }).optional(),\n` +
        `    limit: z.number().int().positive().max(1000).optional(),\n` +
        `  }),\n` +
        `  outputSchema: z.object({ entries: z.array(z.unknown()) }),\n` +
        `  execute: ${exec},\n` +
        `});\n`
      );
  }
}

export function generateMastraToolsModule(ontology: Ontology): string {
  const objectNames = Object.keys(ontology.object_types).map(pascalCase);
  const actionNames = Object.keys(ontology.action_types);
  if (actionNames.length === 0) {
    throw new Error(
      "ontology has zero action types — apply_action requires at least one branch",
    );
  }

  const importLines: string[] = [];
  for (const o of objectNames) importLines.push(`  ${o}Schema,`);
  for (const a of actionNames) {
    importLines.push(`  ${pascalCase(a)}ParamsSchema,`);
  }

  const parts: string[] = [];
  parts.push(HEADER);
  parts.push(`import { z } from "zod";\n`);
  parts.push(`import { createTool } from "@mastra/core/tools";\n`);
  parts.push(
    `import {\n${importLines.join("\n")}\n} from "../ontology/types.generated";\n\n`,
  );

  parts.push("// === READ tools (one per READ op × object type) ===\n\n");
  const toolConstNames: string[] = [];
  for (const objName of objectNames) {
    for (const op of READ_OPS) {
      const constName = `${toolIdFor(op, objName)}Tool`;
      toolConstNames.push(constName);
      parts.push(emitReadToolBlock(op, objName, `${objName}Schema`));
      parts.push("\n");
    }
  }

  parts.push("// === apply_action (discriminated union over action types) ===\n\n");
  const unionBranches = actionNames
    .map(
      (name) =>
        `  z.object({ action: z.literal(${JSON.stringify(name)}), params: ${pascalCase(
          name,
        )}ParamsSchema }),`,
    )
    .join("\n");
  parts.push(
    `export const applyActionInputSchema = z.discriminatedUnion("action", [\n${unionBranches}\n]);\n\n`,
  );
  parts.push(
    `export const applyActionTool = createTool({\n` +
      `  id: "apply_action",\n` +
      `  description: "Apply a named action to mutate ontology state. Input is a discriminated union over the action types declared in the ontology.",\n` +
      `  inputSchema: applyActionInputSchema,\n` +
      `  outputSchema: z.object({\n` +
      `    ok: z.boolean(),\n` +
      `    created: z.object({ object_type: z.string().optional(), id: z.string().optional() }).optional(),\n` +
      `  }),\n` +
      `  execute: async () => { throw new Error("apply_action not implemented (US-027)"); },\n` +
      `});\n\n`,
  );

  const allEntries = [
    ...toolConstNames.map((cn) => `  ${JSON.stringify(cn.slice(0, -4))}: ${cn},`),
    `  ${JSON.stringify("apply_action")}: applyActionTool,`,
  ];
  parts.push(`export const tools = {\n${allEntries.join("\n")}\n} as const;\n`);

  return parts.join("");
}
