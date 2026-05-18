import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { loadOntology } from "@/lib/ontology/load";
import { getDb } from "@/lib/db/client";
import { prettify } from "@/lib/prettify";

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
  const { type } = await params;
  if (!isValidIdent(type)) notFound();

  const ontology = await loadOntology(
    path.join(process.cwd(), "ontology"),
  ).catch(() => null);
  if (!ontology) notFound();

  const objectType = ontology.object_types[type];
  if (!objectType) notFound();

  const tableName = snakeCase(type);
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

  const db = getDb();
  let rows: Array<Record<string, unknown>> = [];
  let queryError: string | null = null;
  try {
    const result = (await db.execute(
      sql.raw(`SELECT * FROM "${tableName}" ORDER BY 1 LIMIT 500`),
    )) as unknown as Array<Record<string, unknown>>;
    rows = result;
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
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-8 py-10">
        <Link
          href="/"
          className="text-xs text-zinc-500 hover:text-zinc-300"
        >
          ← back home
        </Link>
        <div className="mt-2 flex items-baseline justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {prettify(type)}
            </h1>
            {objectType.description ? (
              <p className="mt-1 text-sm text-zinc-400">
                {objectType.description}
              </p>
            ) : null}
            <p className="mt-1 font-mono text-[11px] text-zinc-500">
              table {tableName} · {rows.length} row(s) · {orderedColumns.length} column(s)
            </p>
          </div>
        </div>

        {queryError ? (
          <div
            data-testid="query-error"
            className="mt-6 rounded-md border border-rose-800 bg-rose-950/30 px-3 py-2 text-sm text-rose-200"
          >
            <p className="font-medium">query failed</p>
            <p className="mt-1 font-mono text-xs">{queryError}</p>
            <p className="mt-2 text-xs text-rose-300/80">
              The table may not exist yet. Apply a pending proposal to create
              it.
            </p>
          </div>
        ) : null}

        <div className="mt-8 overflow-x-auto rounded-md border border-zinc-800">
          <table className="w-full divide-y divide-zinc-800 text-sm">
            <thead className="bg-zinc-900/40 text-left text-[10px] uppercase tracking-widest text-zinc-500">
              <tr>
                {orderedColumns.map((c) => (
                  <th key={c.name} className="px-3 py-2 font-medium">
                    {c.name}
                    <span className="ml-1 text-zinc-600">· {String(c.type)}</span>
                  </th>
                ))}
                <th className="px-3 py-2 font-medium">·</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={orderedColumns.length + 1}
                    className="px-3 py-6 text-center text-xs text-zinc-500"
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
                      className="text-zinc-200 hover:bg-zinc-900/60"
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
                          className="text-xs text-violet-300 hover:text-violet-200"
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
