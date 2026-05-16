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
    `    };\n` +
    `    const ctx = payload.ctx;\n` +
    `    if (!ctx) {\n` +
    `      throw new Error(\n` +
    `        \`${id}: event.data.ctx is required (OntologyCtx must be passed in event payload)\`,\n` +
    `      );\n` +
    `    }\n` +
    `    await step.run(${JSON.stringify(`permission-check.${actionName}`)}, () =>\n` +
    `      enforceActionPermission({\n` +
    `        ontology,\n` +
    `        actionName: ${JSON.stringify(actionName)},\n` +
    `        ctx,\n` +
    `      }),\n` +
    `    );\n` +
    `    return await step.run(${JSON.stringify(`declarative.${actionName}`)}, () =>\n` +
    `      runDeclarativeAction({\n` +
    `        actionName: ${JSON.stringify(actionName)},\n` +
    `        ontology,\n` +
    `        params: event.data.params,\n` +
    `        ctx,\n` +
    `      }),\n` +
    `    );\n` +
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
