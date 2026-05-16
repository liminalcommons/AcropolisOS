// US-024: Inngest codegen for declarative actions.
//
// For every action_type in the ontology that carries a declarative directive
// (creates_object / creates_link / updates / deletes), emit an
// `inngest.createFunction` wrapper that delegates to runDeclarativeAction.
// Function-backed action_types (US-025) are emitted by a sibling generator
// later; this module deliberately skips them.

import type { ActionType, Ontology } from "../ontology/schema";

export function inngestFunctionIdFor(actionName: string): string {
  return `acropolisos-action-${actionName}`;
}

export function inngestEventNameFor(actionName: string): string {
  return `acropolisos/action.${actionName}`;
}

export function isDeclarative(action: ActionType): boolean {
  return Boolean(
    action.creates_object ||
      action.creates_link ||
      action.updates ||
      action.deletes,
  );
}

function camelCase(name: string): string {
  const parts = name.split(/[_\-\s]+/g).filter(Boolean);
  if (parts.length === 0) return name;
  return (
    parts[0].toLowerCase() +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join("")
  );
}

function functionConstNameFor(actionName: string): string {
  return `action${
    camelCase(actionName).charAt(0).toUpperCase() +
    camelCase(actionName).slice(1)
  }`;
}

const HEADER =
  "// THIS FILE IS GENERATED. DO NOT EDIT.\n" +
  "// Source: lib/codegen/inngest.ts — regenerate via the ontology codegen pipeline.\n" +
  "\n";

const IMPORTS =
  'import { inngest } from "../inngest/client";\n' +
  'import { runDeclarativeAction } from "../actions/declarative";\n' +
  'import { enforceActionPermission } from "../actions/permission-check";\n' +
  'import {\n' +
  '  auditPreInvocation,\n' +
  '  auditPostInvocation,\n' +
  '} from "../actions/audit-middleware";\n' +
  'import type { Ontology } from "../ontology/schema";\n' +
  'import type { OntologyCtx } from "../ontology/ctx";\n' +
  "\n";

// Stringify the ontology so the generated module carries the same source of
// truth the runner needs at execution time. JSON.parse keeps the generated
// file tractable in size without us having to re-export literals.
function emitOntologyLiteral(ontology: Ontology): string {
  const json = JSON.stringify(ontology);
  // Embed via JSON.parse(<string-literal>) so TypeScript treats it as Ontology
  // after the cast, without needing to spell out the full nested type literal.
  return (
    `const ontology: Ontology = JSON.parse(\n` +
    `  ${JSON.stringify(json)},\n` +
    `) as Ontology;\n\n`
  );
}

function emitFunction(actionName: string): string {
  const constName = functionConstNameFor(actionName);
  const id = inngestFunctionIdFor(actionName);
  const eventName = inngestEventNameFor(actionName);
  const preStep = JSON.stringify(`audit-pre.${actionName}`);
  const permStep = JSON.stringify(`permission-check.${actionName}`);
  const runStep = JSON.stringify(`declarative.${actionName}`);
  const postStep = JSON.stringify(`audit-post.${actionName}`);
  const nameLit = JSON.stringify(actionName);
  return (
    `export const ${constName} = inngest.createFunction(\n` +
    `  {\n` +
    `    id: ${JSON.stringify(id)},\n` +
    `    name: ${JSON.stringify(`acropolisos action ${actionName}`)},\n` +
    `    triggers: [{ event: ${JSON.stringify(eventName)} }],\n` +
    `  },\n` +
    `  async ({ event, step }) => {\n` +
    `    const payload = (event.data ?? {}) as {\n` +
    `      params?: unknown;\n` +
    `      ctx?: OntologyCtx;\n` +
    `      parentAuditId?: string;\n` +
    `    };\n` +
    `    const ctx = payload.ctx;\n` +
    `    if (!ctx) {\n` +
    `      throw new Error(\n` +
    `        \`${id}: event.data.ctx is required (OntologyCtx must be passed in event payload)\`,\n` +
    `      );\n` +
    `    }\n` +
    `    const params = payload.params;\n` +
    `    const parentAuditId = payload.parentAuditId;\n` +
    `    const pre = await step.run(${preStep}, () =>\n` +
    `      auditPreInvocation({\n` +
    `        ctx,\n` +
    `        actionName: ${nameLit},\n` +
    `        params,\n` +
    `        parentAuditId,\n` +
    `      }),\n` +
    `    );\n` +
    `    if (pre.kind === "replay") {\n` +
    `      return pre.priorResult;\n` +
    `    }\n` +
    `    await step.run(${permStep}, () =>\n` +
    `      enforceActionPermission({\n` +
    `        ontology,\n` +
    `        actionName: ${nameLit},\n` +
    `        ctx,\n` +
    `      }),\n` +
    `    );\n` +
    `    const startedAt = Date.now();\n` +
    `    try {\n` +
    `      const result = await step.run(${runStep}, () =>\n` +
    `        runDeclarativeAction({\n` +
    `          actionName: ${nameLit},\n` +
    `          ontology,\n` +
    `          params,\n` +
    `          ctx,\n` +
    `        }),\n` +
    `      );\n` +
    `      await step.run(${postStep}, () =>\n` +
    `        auditPostInvocation({\n` +
    `          ctx,\n` +
    `          actionName: ${nameLit},\n` +
    `          params,\n` +
    `          pendingAuditId: pre.pendingAuditId,\n` +
    `          idempotencyKey: pre.idempotencyKey,\n` +
    `          parentAuditId,\n` +
    `          status: "ok",\n` +
    `          durationMs: Date.now() - startedAt,\n` +
    `          result,\n` +
    `        }),\n` +
    `      );\n` +
    `      return result;\n` +
    `    } catch (err) {\n` +
    `      await step.run(${postStep}, () =>\n` +
    `        auditPostInvocation({\n` +
    `          ctx,\n` +
    `          actionName: ${nameLit},\n` +
    `          params,\n` +
    `          pendingAuditId: pre.pendingAuditId,\n` +
    `          idempotencyKey: pre.idempotencyKey,\n` +
    `          parentAuditId,\n` +
    `          status: "error",\n` +
    `          durationMs: Date.now() - startedAt,\n` +
    `          error: err,\n` +
    `        }),\n` +
    `      );\n` +
    `      throw err;\n` +
    `    }\n` +
    `  },\n` +
    `);\n\n`
  );
}

export function generateInngestActionsModule(ontology: Ontology): string {
  const declarativeActions = Object.entries(ontology.action_types).filter(
    ([, a]) => isDeclarative(a),
  );

  const parts: string[] = [HEADER, IMPORTS, emitOntologyLiteral(ontology)];

  for (const [actionName] of declarativeActions) {
    parts.push(emitFunction(actionName));
  }

  const arrayBody = declarativeActions
    .map(([n]) => `  ${functionConstNameFor(n)},`)
    .join("\n");
  parts.push(
    `export const declarativeActionFunctions = [\n${arrayBody}\n] as const;\n`,
  );

  return parts.join("");
}
