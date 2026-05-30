import Link from "next/link";
import { notFound } from "next/navigation";
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import { pascalToSnake } from "@/lib/ontology/casing";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { prettify } from "@/lib/prettify";
import { buildCanWriteType } from "@/lib/widgets/write-api";
import { deriveFormFields } from "@/lib/ontology/object-form";
import { ObjectForm } from "@/components/generated/ObjectForm";
import { createObjectAction } from "./actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: Promise<{ type: string }>;
}

function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

function isValidIdent(s: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_]*$/.test(s);
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// US-021 (v1): auto-CRUD list view per object type. Loads the ontology to
// discover the type's properties, queries the live Postgres table by the
// snake_case table name, and renders a sortable read-only table. Detail
// pages live at /[type]/[id]; edit + create come in a follow-up once the
// add_<type> action wiring lands.
export default async function ObjectTypeListPage(
  { params }: PageProps,
): Promise<React.ReactElement> {
  const { type: typeParam } = await params;
  if (!isValidIdent(typeParam)) notFound();

  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) notFound();

  const ontology = await loadOntology(getRuntimeOntologyDir()).catch(
    () => null,
  );
  if (!ontology) notFound();

  // Accept either the PascalCase ontology key ("Guest") or the snake token
  // ("guest") — board cards link with the token (config.type).
  const type = ontology.object_types[typeParam]
    ? typeParam
    : Object.keys(ontology.object_types).find(
        (k) => pascalToSnake(k) === typeParam,
      );
  if (!type) notFound();

  const objectType = ontology.object_types[type];
  if (!objectType) notFound();

  const access = (chatRuntime.ctx.objects as Record<string, { findMany: () => Promise<Record<string, unknown>[]>; findById: (id: string) => Promise<Record<string, unknown> | null> }>)[type];
  if (!access) notFound();

  const tableName = snakeCase(type);
  const canWrite = buildCanWriteType(chatRuntime.actor, ontology)(pascalToSnake(type));
  const formFields = deriveFormFields(ontology, type);
  const propertyNames = Object.keys(objectType.properties ?? {});

  // Resolve property types via the shared registry when a ref is used so
  // the displayed type hints match the ontology's truth.
  const columns = propertyNames.map((p) => {
    const def = objectType.properties[p];
    const resolved =
      "ref" in def && def.ref
        ? ontology.properties[def.ref] ?? null
        : null;
    const t = resolved?.type ?? ("type" in def ? def.type : "string");
    return { name: p, type: t };
  });

  let rows: Array<Record<string, unknown>> = [];
  let queryError: string | null = null;
  try {
    rows = await access.findMany();
  } catch (err) {
    queryError = err instanceof Error ? err.message : String(err);
  }

  const seenColumns = new Set(columns.map((c) => c.name));
  for (const r of rows) {
    for (const k of Object.keys(r)) seenColumns.add(k);
  }
  const orderedColumns = [
    ...columns,
    ...Array.from(seenColumns)
      .filter((c) => !columns.some((col) => col.name === c))
      .map((c) => ({ name: c, type: "—" })),
  ];

  return (
    <main>
      <div className="mx-auto max-w-6xl px-8 py-10">
        <Link
          href="/ontology-editor"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← ontology editor
        </Link>
        <div className="mt-2 flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {prettify(type)}
            </h1>
            {objectType.description ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {objectType.description}
              </p>
            ) : null}
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              table {tableName} · {rows.length} row(s) · {orderedColumns.length} column(s)
            </p>
          </div>
        </div>

        {canWrite && formFields.length > 0 ? (
          <details className="mt-6 rounded-md border border-border bg-card/20 p-4">
            <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
              + New {prettify(type)}
            </summary>
            <div className="mt-4">
              <ObjectForm
                fields={formFields}
                submitLabel={`Create ${prettify(type)}`}
                action={createObjectAction.bind(null, type)}
              />
            </div>
          </details>
        ) : null}

        {queryError ? (
          <div
            data-testid="query-error"
            className="mt-6 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-sm text-destructive"
          >
            <p className="font-medium">query failed</p>
            <p className="mt-1 font-mono text-xs">{queryError}</p>
            <p className="mt-2 text-xs text-destructive/80">
              The table may not exist yet. Apply a pending proposal to create
              it.
            </p>
          </div>
        ) : null}

        <div className="mt-8 overflow-x-auto rounded-md border border-border">
          <table className="w-full divide-y divide-border text-sm">
            <thead className="bg-card/40 text-left text-xs uppercase tracking-widest text-muted-foreground">
              <tr>
                {orderedColumns.map((c) => (
                  <th key={c.name} className="px-3 py-2 font-medium">
                    {c.name}
                    <span className="ml-1 text-muted-foreground">· {String(c.type)}</span>
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">·</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={orderedColumns.length + 1}
                    className="px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    no rows yet
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => {
                  const id = String(row.id ?? i);
                  return (
                    <tr
                      key={id}
                      data-testid={`row-${id}`}
                      className="text-foreground hover:bg-card/60"
                    >
                      {orderedColumns.map((c) => (
                        <td
                          key={c.name}
                          className="px-3 py-2 font-mono text-xs leading-relaxed"
                        >
                          {formatCell(row[c.name])}
                        </td>
                      ))}
                      <td className="px-3 py-2">
                        <Link
                          href={`/${type}/${id}`}
                          className="text-xs text-primary hover:text-primary/80"
                        >
                          open →
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
