// Per-bundle index — lists every table in the seed_<bundle> schema with row counts.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ bundle: string }>;
}

interface TableRow {
  table_name: string;
  row_count: number;
}

async function listBundleTables(schemaName: string): Promise<TableRow[] | null> {
  const db = getDb();
  // First confirm the schema exists
  const schemas = await db.$client.unsafe<{ exists: boolean }[]>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_namespace WHERE nspname = $1
     ) AS exists`,
    [schemaName],
  );
  if (!schemas[0]?.exists) return null;

  // List tables
  const tables = await db.$client.unsafe<{ table_name: string }[]>(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = $1
      ORDER BY table_name`,
    [schemaName],
  );
  // Count each table — quote schema + table identifiers
  const rows: TableRow[] = [];
  for (const t of tables) {
    const c = await db.$client.unsafe<{ count: string }[]>(
      `SELECT count(*)::text AS count FROM "${schemaName}"."${t.table_name}"`,
    );
    rows.push({ table_name: t.table_name, row_count: Number(c[0]?.count ?? 0) });
  }
  return rows;
}

export default async function BundleIndexPage({
  params,
}: PageProps): Promise<React.ReactElement> {
  const { bundle } = await params;
  // Bundles are identified by snake_case to match Postgres schema naming.
  const schemaName = `seed_${bundle.replace(/-/g, "_")}`;
  const tables = await listBundleTables(schemaName);
  if (!tables) notFound();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-5xl px-8 py-12">
        <div className="flex items-center gap-4">
          <Link
            href="/seed"
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            ← seed bundles
          </Link>
        </div>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
          {bundle}
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          Schema: <code className="font-mono">{schemaName}</code> · {tables.length}{" "}
          tables
        </p>

        <table
          data-testid="seed-bundle-tables"
          className="mt-8 w-full text-left text-sm"
        >
          <thead className="text-zinc-500 uppercase tracking-wider text-xs">
            <tr>
              <th className="py-2 pr-3">table</th>
              <th className="py-2 pr-3">rows</th>
              <th className="py-2 pr-3">view</th>
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <tr key={t.table_name} className="border-t border-zinc-900">
                <td className="py-2 pr-3 font-mono text-emerald-300">
                  {t.table_name}
                </td>
                <td className="py-2 pr-3 font-mono text-zinc-300">
                  {t.row_count}
                </td>
                <td className="py-2 pr-3">
                  {t.row_count > 0 ? (
                    <Link
                      href={`/seed/${bundle}/${t.table_name}`}
                      className="text-emerald-400 hover:text-emerald-300"
                    >
                      open →
                    </Link>
                  ) : (
                    <span className="text-zinc-600">empty</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
