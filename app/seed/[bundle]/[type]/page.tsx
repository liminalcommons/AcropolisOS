// Per-table row view — generic table renderer for any seed_<bundle>.<type> table.
// Reads the table's columns + first 200 rows, renders as an HTML table.
// Safe identifier quoting; no JSONB cells today (the seed bundles don't use JSONB).
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ bundle: string; type: string }>;
}

interface ColMeta {
  column_name: string;
  data_type: string;
}

const MAX_ROWS = 200;

async function fetchTable(
  schemaName: string,
  tableName: string,
): Promise<{ cols: ColMeta[]; rows: Record<string, unknown>[] } | null> {
  const db = getDb();
  const cols = await db.$client.unsafe<ColMeta[]>(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position`,
    [schemaName, tableName],
  );
  if (cols.length === 0) return null;

  // Quote the schema and table identifiers; user input is constrained by
  // the existence check above (cols.length === 0 ⇒ unknown table ⇒ 404).
  const rows = await db.$client.unsafe<Record<string, unknown>[]>(
    `SELECT * FROM "${schemaName}"."${tableName}" LIMIT ${MAX_ROWS}`,
  );
  return { cols, rows };
}

function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default async function SeedTablePage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const { bundle, type } = await params;
  const schemaName = `seed_${bundle.replace(/-/g, "_")}`;
  // Permissive on type — Postgres lowercases unquoted, and seed tables are snake_case.
  const tableName = type.toLowerCase();
  const data = await fetchTable(schemaName, tableName);
  if (!data) notFound();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-8 py-12">
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          <Link href="/seed" className="hover:text-zinc-300">
            seed
          </Link>
          <span>·</span>
          <Link href={`/seed/${bundle}`} className="hover:text-zinc-300">
            {bundle}
          </Link>
        </div>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
          {tableName}
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          <code className="font-mono">{schemaName}.{tableName}</code> — showing{" "}
          {data.rows.length} of up to {MAX_ROWS} rows.
        </p>

        <div className="mt-8 overflow-x-auto">
          <table
            data-testid="seed-table-rows"
            className="w-full text-left text-xs"
          >
            <thead className="text-zinc-500 uppercase tracking-wider">
              <tr>
                {data.cols.map((c) => (
                  <th key={c.column_name} className="py-2 pr-3 font-mono">
                    {c.column_name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="text-zinc-300">
              {data.rows.map((r, i) => (
                <tr key={i} className="border-t border-zinc-900">
                  {data.cols.map((c) => (
                    <td
                      key={c.column_name}
                      className="py-2 pr-3 font-mono align-top"
                    >
                      {fmtCell(r[c.column_name])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
