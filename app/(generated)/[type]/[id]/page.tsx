import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "drizzle-orm";
import { loadOntology } from "@/lib/ontology/load";
import { getDb } from "@/lib/db/client";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { prettify } from "@/lib/prettify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: Promise<{ type: string; id: string }>;
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

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

export default async function ObjectDetailPage(
  { params }: PageProps,
): Promise<React.ReactElement> {
  const { type, id } = await params;
  if (!isValidIdent(type)) notFound();

  // SECURITY: gate to authenticated stewards (same as the list view). This raw
  // per-type detail reader bypasses the permission boundary. notFound() hides it.
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor) || chatRuntime.actor.role !== "steward") {
    notFound();
  }

  const ontology = await loadOntology(
    path.join(process.cwd(), "ontology"),
  ).catch(() => null);
  if (!ontology) notFound();
  const objectType = ontology.object_types[type];
  if (!objectType) notFound();

  const tableName = snakeCase(type);
  const db = getDb();

  let row: Record<string, unknown> | null = null;
  let queryError: string | null = null;
  try {
    const result = (await db.execute(
      sql.raw(
        `SELECT * FROM "${tableName}" WHERE id = '${id.replace(/'/g, "''")}' LIMIT 1`,
      ),
    )) as unknown as Array<Record<string, unknown>>;
    row = result[0] ?? null;
  } catch (err) {
    queryError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main>
      <div className="mx-auto max-w-3xl px-8 py-10">
        <Link
          href={`/${type}`}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← back to {prettify(type)} list
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          {prettify(type)} · <span className="font-mono text-muted-foreground">{id.slice(0, 8)}</span>
        </h1>

        {queryError ? (
          <div className="mt-6 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-sm text-destructive">
            <p className="font-medium">query failed</p>
            <p className="mt-1 font-mono text-xs">{queryError}</p>
          </div>
        ) : !row ? (
          <p className="mt-8 text-sm text-muted-foreground">no row with id {id}</p>
        ) : (
          <dl className="mt-8 divide-y divide-border rounded-md border border-border">
            {Object.entries(row).map(([k, v]) => (
              <div
                key={k}
                className="grid grid-cols-3 gap-4 px-4 py-3"
                data-testid={`field-${k}`}
              >
                <dt className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                  {k}
                </dt>
                <dd className="col-span-2 font-mono text-sm leading-relaxed text-foreground">
                  {formatValue(v)}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </main>
  );
}
