// US-021: Refine codegen — YAML ontology to auto-CRUD Next.js routes.
//
// For every object_type in the ontology, emit four client-side Next.js
// App Router pages (list/detail/edit/create) plus a resources manifest
// the layout consumes. Pages render via the Refine inferencer wired to
// the ctx-backed data provider in lib/refine/data-provider.ts — so reads
// and writes flow through the typed ontology surface (and inherit its
// permission filtering + audit).
//
// The create form additionally surfaces the matching add_<type> action's
// parameter schema as form fields so users can submit against the same
// shape the action runner expects (US-024 / US-027).

import type { Ontology } from "../ontology/schema";
import { pascalCase } from "./zod";

export interface GeneratedFile {
  path: string;
  content: string;
}

const HEADER =
  "// THIS FILE IS GENERATED. DO NOT EDIT.\n" +
  "// Source: lib/codegen/refine.ts — regenerate via the ontology codegen pipeline.\n" +
  "\n";

// One Refine inferencer entrypoint we use across all four views. The
// `headless` build leaves rendering to the host app (which is what the
// custom-view override slot expects too), keeping the runtime small.
const INFERENCER_IMPORT =
  'import { Inferencer } from "@refinedev/inferencer/headless";\n';

function findAddActionForType(
  ontology: Ontology,
  objectType: string,
): { actionName: string; pascalParamsSchema: string; paramNames: string[] } | null {
  for (const [name, action] of Object.entries(ontology.action_types)) {
    if (action.creates_object === objectType) {
      const paramNames = Object.keys(action.parameters ?? {});
      return {
        actionName: name,
        pascalParamsSchema: `${pascalCase(name)}ParamsSchema`,
        paramNames,
      };
    }
  }
  return null;
}

function emitListPage(objectType: string): GeneratedFile {
  const content =
    HEADER +
    '"use client";\n' +
    INFERENCER_IMPORT +
    'import { createOntologyDataProvider } from "@/lib/refine/data-provider";\n' +
    "\n" +
    `export default function ${objectType}ListPage() {\n` +
    `  return (\n` +
    `    <Inferencer\n` +
    `      view="list"\n` +
    `      resource="${objectType}"\n` +
    `      dataProviderFactory={createOntologyDataProvider}\n` +
    `    />\n` +
    `  );\n` +
    "}\n";
  return { path: `app/(generated)/${objectType}/page.tsx`, content };
}

function emitDetailPage(objectType: string): GeneratedFile {
  const content =
    HEADER +
    '"use client";\n' +
    INFERENCER_IMPORT +
    'import { createOntologyDataProvider } from "@/lib/refine/data-provider";\n' +
    "\n" +
    `export default function ${objectType}DetailPage({ params }: { params: { id: string } }) {\n` +
    `  const { id } = params;\n` +
    `  return (\n` +
    `    <Inferencer\n` +
    `      view="show"\n` +
    `      resource="${objectType}"\n` +
    `      id={id}\n` +
    `      dataProviderFactory={createOntologyDataProvider}\n` +
    `    />\n` +
    `  );\n` +
    "}\n";
  return { path: `app/(generated)/${objectType}/[id]/page.tsx`, content };
}

function emitEditPage(objectType: string): GeneratedFile {
  const content =
    HEADER +
    '"use client";\n' +
    INFERENCER_IMPORT +
    'import { createOntologyDataProvider } from "@/lib/refine/data-provider";\n' +
    "\n" +
    `export default function ${objectType}EditPage({ params }: { params: { id: string } }) {\n` +
    `  const { id } = params;\n` +
    `  return (\n` +
    `    <Inferencer\n` +
    `      view="edit"\n` +
    `      resource="${objectType}"\n` +
    `      id={id}\n` +
    `      dataProviderFactory={createOntologyDataProvider}\n` +
    `    />\n` +
    `  );\n` +
    "}\n";
  return { path: `app/(generated)/${objectType}/[id]/edit/page.tsx`, content };
}

function emitCreatePage(
  objectType: string,
  ontology: Ontology,
): GeneratedFile {
  const addAction = findAddActionForType(ontology, objectType);
  if (addAction) {
    const fieldList = addAction.paramNames
      .map((p) => `        ${JSON.stringify(p)},`)
      .join("\n");
    const content =
      HEADER +
      '"use client";\n' +
      INFERENCER_IMPORT +
      'import { createOntologyDataProvider } from "@/lib/refine/data-provider";\n' +
      `import { ${addAction.pascalParamsSchema} } from "@/lib/ontology/types.generated";\n` +
      "\n" +
      `// Wires this create form to the action runner: submitting the form\n` +
      `// will invoke apply_action with these parameters (US-024 / US-027).\n` +
      `const actionBinding = {\n` +
      `  actionName: ${JSON.stringify(addAction.actionName)},\n` +
      `  paramsSchema: ${addAction.pascalParamsSchema},\n` +
      `  fields: [\n${fieldList}\n  ] as const,\n` +
      `};\n` +
      "\n" +
      `export default function ${objectType}CreatePage() {\n` +
      `  return (\n` +
      `    <Inferencer\n` +
      `      view="create"\n` +
      `      resource="${objectType}"\n` +
      `      action={actionBinding}\n` +
      `      dataProviderFactory={createOntologyDataProvider}\n` +
      `    />\n` +
      `  );\n` +
      "}\n";
    return { path: `app/(generated)/${objectType}/new/page.tsx`, content };
  }
  // No matching add_<type> action — fall back to the bare inferencer create.
  const content =
    HEADER +
    '"use client";\n' +
    INFERENCER_IMPORT +
    'import { createOntologyDataProvider } from "@/lib/refine/data-provider";\n' +
    "\n" +
    `export default function ${objectType}CreatePage() {\n` +
    `  return (\n` +
    `    <Inferencer\n` +
    `      view="create"\n` +
    `      resource="${objectType}"\n` +
    `      dataProviderFactory={createOntologyDataProvider}\n` +
    `    />\n` +
    `  );\n` +
    "}\n";
  return { path: `app/(generated)/${objectType}/new/page.tsx`, content };
}

function emitResourcesManifest(ontology: Ontology): GeneratedFile {
  const lines = Object.keys(ontology.object_types).map((rawName) => {
    const t = pascalCase(rawName);
    return (
      `  {\n` +
      `    name: "${t}",\n` +
      `    list: "/${t}",\n` +
      `    show: "/${t}/:id",\n` +
      `    edit: "/${t}/:id/edit",\n` +
      `    create: "/${t}/new",\n` +
      `  },`
    );
  });
  const content =
    HEADER +
    `export interface GeneratedResource {\n` +
    `  name: string;\n` +
    `  list: string;\n` +
    `  show: string;\n` +
    `  edit: string;\n` +
    `  create: string;\n` +
    `}\n\n` +
    `export const generatedResources: ReadonlyArray<GeneratedResource> = [\n` +
    lines.join("\n") +
    `\n] as const;\n`;
  return { path: "app/(generated)/resources.generated.ts", content };
}

export function generateRefineRoutes(ontology: Ontology): GeneratedFile[] {
  const files: GeneratedFile[] = [];

  for (const rawName of Object.keys(ontology.object_types)) {
    const typeName = pascalCase(rawName);
    files.push(emitListPage(typeName));
    files.push(emitDetailPage(typeName));
    files.push(emitEditPage(typeName));
    files.push(emitCreatePage(typeName, ontology));
  }

  files.push(emitResourcesManifest(ontology));
  return files;
}
