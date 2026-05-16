// US-014: Real-execute READ tools.
//
// US-013's codegen emits per-(READ op × object type) tool stubs (one per
// describe/query/traverse/sample/read/audit). This module wraps the stubs
// with executes that route through `OntologyCtx` so:
//
//   - permission filtering (object-level + property-level) comes "for free"
//     from US-031's wrapped ctx,
//   - tests can drive each tool against an in-memory store without spinning
//     up the full agent stack,
//   - the agent at runtime sees the same shape `tools.generated.ts` declares.
//
// The static `tools.generated.ts` keeps its `throw new Error("... not
// implemented")` body because nothing imports its executes — runtime always
// goes through `getToolsForActor`, which calls into this module.

import { z } from "zod";
import { createTool } from "@mastra/core/tools";
import type { AnyMastraTool } from "../codegen/mastra-tools";
import { READ_OPS, toolIdFor } from "../codegen/mastra-tools";
import { pascalCase } from "../codegen/zod";
import type { Ontology } from "../ontology/schema";
import type {
  LinkAccess,
  ObjectAccess,
  OntologyCtx,
} from "../ontology/ctx";

// Untyped views over ctx surface — at this layer we iterate object/link names
// dynamically against the loaded ontology rather than the hand-typed ctx shape.
type AnyRow = { id: string } & Record<string, unknown>;
type AnyLink = LinkAccess<Record<string, unknown>>;
type AnyObject = ObjectAccess<AnyRow>;

const SAMPLE_DEFAULT = 5;
const QUERY_DEFAULT_LIMIT = 100;
const AUDIT_DEFAULT_LIMIT = 50;

export interface BuildReadToolsInput {
  ontology: Ontology;
  ctx: OntologyCtx;
}

export function buildReadToolsForActor({
  ontology,
  ctx,
}: BuildReadToolsInput): Record<string, AnyMastraTool> {
  const out: Record<string, AnyMastraTool> = {};

  for (const objName of Object.keys(ontology.object_types)) {
    const pascal = pascalCase(objName);
    for (const op of READ_OPS) {
      out[toolIdFor(op, pascal)] = buildOne(op, pascal, ctx, ontology);
    }
  }

  return out;
}

function getObjectAccess(
  ctx: OntologyCtx,
  pascalName: string,
): AnyObject | null {
  const bag = ctx.objects as unknown as Record<string, AnyObject>;
  const direct = bag[pascalName];
  return direct ?? null;
}

function objectMatchesFilter(
  row: Record<string, unknown>,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) return true;
  for (const [k, v] of Object.entries(filter)) {
    if (row[k] !== v) return false;
  }
  return true;
}

function buildOne(
  op: (typeof READ_OPS)[number],
  pascalName: string,
  ctx: OntologyCtx,
  ontology: Ontology,
): AnyMastraTool {
  const id = toolIdFor(op, pascalName);
  switch (op) {
    case "describe":
      return createTool({
        id,
        description: `Describe the ${pascalName} object type (properties, links, permissions).`,
        inputSchema: z.object({}),
        outputSchema: z.object({
          name: z.string(),
          properties: z.record(z.string(), z.unknown()),
          permissions: z
            .object({
              read: z.array(z.string()).optional(),
              write: z.array(z.string()).optional(),
            })
            .optional(),
        }),
        execute: async () => {
          const def = ontology.object_types[pascalName];
          if (!def) {
            throw new Error(`unknown object type ${pascalName}`);
          }
          return {
            name: pascalName,
            properties: def.properties as Record<string, unknown>,
            ...(def.permissions ? { permissions: def.permissions } : {}),
          };
        },
      });

    case "query":
      return createTool({
        id,
        description: `Query ${pascalName} records by an optional filter.`,
        inputSchema: z.object({
          filter: z.record(z.string(), z.unknown()).optional(),
          limit: z.number().int().positive().max(1000).optional(),
        }),
        outputSchema: z.object({ results: z.array(z.unknown()) }),
        execute: async (input: {
          filter?: Record<string, unknown>;
          limit?: number;
        } = {}) => {
          const access = getObjectAccess(ctx, pascalName);
          if (!access) return { results: [] };
          const all = await access.findMany();
          const filtered = all.filter((row) =>
            objectMatchesFilter(row, input.filter),
          );
          const limit = input.limit ?? QUERY_DEFAULT_LIMIT;
          return { results: filtered.slice(0, limit) };
        },
      });

    case "traverse":
      return createTool({
        id,
        description: `Traverse outgoing links from a ${pascalName} record.`,
        inputSchema: z.object({
          id: z.string(),
          link: z.string().optional(),
        }),
        outputSchema: z.object({ linked: z.array(z.unknown()) }),
        execute: async (input: { id: string; link?: string }) => {
          const links = ctx.links as unknown as Record<string, AnyLink>;
          const out: Array<{
            link: string;
            from: string;
            to: string;
            properties: unknown;
          }> = [];
          for (const [linkName, linkDef] of Object.entries(ontology.link_types)) {
            if (linkDef.from !== pascalName) continue;
            if (input.link && input.link !== linkName) continue;
            const access = links[linkName];
            if (!access) continue;
            const edges = await access.traverse({ from: input.id });
            for (const edge of edges) {
              out.push({
                link: linkName,
                from: edge.from,
                to: edge.to,
                properties: edge.properties,
              });
            }
          }
          return { linked: out };
        },
      });

    case "sample":
      return createTool({
        id,
        description: `Return up to N representative ${pascalName} records.`,
        inputSchema: z.object({
          n: z.number().int().positive().max(100).default(SAMPLE_DEFAULT),
        }),
        outputSchema: z.object({ samples: z.array(z.unknown()) }),
        execute: async (input: { n?: number } = {}) => {
          const access = getObjectAccess(ctx, pascalName);
          if (!access) return { samples: [] };
          const all = await access.findMany();
          return { samples: all.slice(0, input.n ?? SAMPLE_DEFAULT) };
        },
      });

    case "read":
      return createTool({
        id,
        description: `Read a single ${pascalName} record by id.`,
        inputSchema: z.object({ id: z.string() }),
        // Output is intentionally loose: ctx's permission-filtering wrapper
        // may strip property-level-restricted fields (US-031), so the row
        // can omit columns the strict ${pascalName}Schema declares required.
        outputSchema: z.object({ record: z.unknown().nullable() }),
        execute: async (input: { id: string }) => {
          const access = getObjectAccess(ctx, pascalName);
          if (!access) return { record: null };
          const row = await access.findById(input.id);
          return { record: row };
        },
      });

    case "audit":
      return createTool({
        id,
        description: `Return recent audit entries scoped to ${pascalName}.`,
        inputSchema: z.object({
          id: z.string().optional(),
          since: z.iso.datetime({ offset: true }).optional(),
          limit: z.number().int().positive().max(1000).optional(),
        }),
        outputSchema: z.object({ entries: z.array(z.unknown()) }),
        execute: async (
          input: { id?: string; since?: string; limit?: number } = {},
        ) => {
          if (!ctx.audit) return { entries: [] };
          const ontologyRows = await ctx.audit.listOntologyAudit();
          const actionRows = await ctx.audit.listActionAudit();
          const since = input.since ? new Date(input.since).getTime() : null;
          const all = [...ontologyRows, ...actionRows]
            .filter((row) => row.subject_type === pascalName)
            .filter((row) => (input.id ? row.subject_id === input.id : true))
            .filter((row) =>
              since === null ? true : row.at.getTime() >= since,
            )
            .sort((a, b) => b.at.getTime() - a.at.getTime());
          const limit = input.limit ?? AUDIT_DEFAULT_LIMIT;
          return { entries: all.slice(0, limit) };
        },
      });
  }
}

// Test helper: invoke a tool's `execute` without going through Mastra's
// validation wrapper. Mirrors the pattern `runApplyActionTool` already uses
// for apply_action (lib/agent/tool-gating.ts).
export async function invokeReadTool(
  tool: AnyMastraTool | undefined,
  input: Record<string, unknown>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  if (!tool) throw new Error("tool is undefined");
  if (!tool.execute) throw new Error(`tool ${tool.id} has no execute function`);
  // The second arg (Mastra execution context) is unused by READ tool executes;
  // a structural-cast empty object satisfies the type while preserving runtime.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tool.execute as any)(input, {});
}
