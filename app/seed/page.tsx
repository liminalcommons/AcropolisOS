// Bundles index — lists every seed_<bundle> schema currently present in the DB.
// Reads pg_namespace at runtime, so it picks up whatever scripts/seed-from-bundle.ts
// has loaded without any wiring.
import Link from "next/link";
import { getDb } from "@/lib/db/client";

export const dynamic = "force-dynamic";

interface SchemaRow {
  schema_name: string;
  table_count: number;
}

async function listSeedSchemas(): Promise<SchemaRow[]> {
  const db = getDb();
  const result = await db.$client.unsafe<{ schema_name: string; table_count: string }[]>(
    `SELECT n.nspname AS schema_name,
            count(c.relname)::text AS table_count
       FROM pg_namespace n
       LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind = 'r'
      WHERE n.nspname LIKE 'seed_%'
      GROUP BY n.nspname
      ORDER BY n.nspname`,
  );
  return result.map((r) => ({
    schema_name: r.schema_name,
    table_count: Number(r.table_count),
  }));
}

export default async function SeedIndexPage(): Promise<React.ReactElement> {
  const schemas = await listSeedSchemas();
  return (
    <main>
      <div className="mx-auto max-w-5xl px-8 py-12">
        <Link href="/ontology-editor" className="text-xs text-muted-foreground hover:text-foreground">
          ← ontology editor
        </Link>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
          seed bundles
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          Domain ontologies loaded into namespaced Postgres schemas (see{" "}
          <code className="font-mono">scripts/seed-from-bundle.ts</code>).
          The kernel <code className="font-mono">public.*</code> schema is
          unaffected.
        </p>

        {schemas.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">
            No seed bundles loaded. Run{" "}
            <code className="font-mono">
              npx tsx scripts/seed-from-bundle.ts &lt;bundle&gt; --insert
            </code>{" "}
            to populate one.
          </p>
        ) : (
          <table
            data-testid="seed-bundle-list"
            className="mt-8 w-full text-left text-sm"
          >
            <thead className="text-muted-foreground uppercase tracking-wider text-xs">
              <tr>
                <th className="py-2 pr-3">schema</th>
                <th className="py-2 pr-3">tables</th>
                <th className="py-2 pr-3">bundle</th>
              </tr>
            </thead>
            <tbody>
              {schemas.map((s) => {
                const bundleName = s.schema_name.replace(/^seed_/, "");
                return (
                  <tr key={s.schema_name} className="border-t border-border">
                    <td className="py-2 pr-3 font-mono text-emerald-300">
                      {s.schema_name}
                    </td>
                    <td className="py-2 pr-3 font-mono text-foreground">
                      {s.table_count}
                    </td>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/seed/${bundleName}`}
                        className="text-emerald-400 hover:text-emerald-300"
                      >
                        explore →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
