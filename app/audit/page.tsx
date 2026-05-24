import Link from "next/link";
import { getDb } from "@/lib/db/client";
import {
  PgAuditReader,
  type DataAuditRow,
} from "@/lib/audit/reader";
import type { AuditRow } from "@/lib/audit/writer";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams?: Promise<{
    tab?: string;
    actor?: string;
    subject_type?: string;
    table?: string;
    operation?: string;
  }>;
}

const TABS = ["ontology", "action", "data"] as const;
type TabKey = (typeof TABS)[number];

function asTab(input: string | undefined): TabKey {
  return TABS.includes(input as TabKey) ? (input as TabKey) : "ontology";
}

function fmtTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

function jsonPreview(v: unknown): string {
  if (v === null || v === undefined) return "—";
  const s = JSON.stringify(v);
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

function OntologyTab({ rows }: { rows: AuditRow[] }): React.ReactElement {
  if (rows.length === 0) {
    return (
      <p className="mt-4 text-sm text-zinc-500">
        No ontology audit rows match this filter.
      </p>
    );
  }
  return (
    <table
      data-testid="audit-table-ontology"
      className="mt-4 w-full text-left text-xs"
    >
      <thead className="text-zinc-500 uppercase tracking-wider">
        <tr>
          <th className="py-2 pr-3">at</th>
          <th className="py-2 pr-3">actor</th>
          <th className="py-2 pr-3">via</th>
          <th className="py-2 pr-3">subject</th>
          <th className="py-2 pr-3">metadata</th>
          <th className="py-2 pr-3">link</th>
        </tr>
      </thead>
      <tbody className="text-zinc-300">
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-zinc-900">
            <td className="py-2 pr-3 font-mono">{fmtTime(r.at)}</td>
            <td className="py-2 pr-3">
              {r.actor}{" "}
              <span className="text-zinc-600">({r.actor_role})</span>
            </td>
            <td className="py-2 pr-3 font-mono">{r.via}</td>
            <td className="py-2 pr-3 font-mono">
              {r.subject_type}/{r.subject_id.slice(0, 8)}
            </td>
            <td className="py-2 pr-3 font-mono text-zinc-500">
              {jsonPreview(r.metadata)}
            </td>
            <td className="py-2 pr-3">
              {r.subject_type === "proposal" ? (
                <Link
                  className="text-emerald-400 hover:text-emerald-300"
                  href={`/proposals/${r.subject_id}`}
                >
                  open
                </Link>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ActionTab({ rows }: { rows: AuditRow[] }): React.ReactElement {
  if (rows.length === 0) {
    return (
      <p className="mt-4 text-sm text-zinc-500">
        No action audit rows match this filter.
      </p>
    );
  }
  return (
    <table
      data-testid="audit-table-action"
      className="mt-4 w-full text-left text-xs"
    >
      <thead className="text-zinc-500 uppercase tracking-wider">
        <tr>
          <th className="py-2 pr-3">at</th>
          <th className="py-2 pr-3">actor</th>
          <th className="py-2 pr-3">via</th>
          <th className="py-2 pr-3">subject</th>
          <th className="py-2 pr-3">metadata</th>
        </tr>
      </thead>
      <tbody className="text-zinc-300">
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-zinc-900">
            <td className="py-2 pr-3 font-mono">{fmtTime(r.at)}</td>
            <td className="py-2 pr-3">
              {r.actor}{" "}
              <span className="text-zinc-600">({r.actor_role})</span>
            </td>
            <td className="py-2 pr-3 font-mono">{r.via}</td>
            <td className="py-2 pr-3 font-mono">
              {r.subject_type}/{r.subject_id.slice(0, 8)}
            </td>
            <td className="py-2 pr-3 font-mono text-zinc-500">
              {jsonPreview(r.metadata)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DataTab({ rows }: { rows: DataAuditRow[] }): React.ReactElement {
  if (rows.length === 0) {
    return (
      <p className="mt-4 text-sm text-zinc-500">
        No data audit rows match this filter. Only object types with{" "}
        <code className="font-mono">data_audit: true</code> emit rows here.
      </p>
    );
  }
  return (
    <table
      data-testid="audit-table-data"
      className="mt-4 w-full text-left text-xs"
    >
      <thead className="text-zinc-500 uppercase tracking-wider">
        <tr>
          <th className="py-2 pr-3">at</th>
          <th className="py-2 pr-3">table</th>
          <th className="py-2 pr-3">row</th>
          <th className="py-2 pr-3">op</th>
          <th className="py-2 pr-3">actor</th>
          <th className="py-2 pr-3">after</th>
        </tr>
      </thead>
      <tbody className="text-zinc-300">
        {rows.map((r) => (
          <tr key={r.id} className="border-t border-zinc-900">
            <td className="py-2 pr-3 font-mono">{fmtTime(r.at)}</td>
            <td className="py-2 pr-3 font-mono">{r.table_name}</td>
            <td className="py-2 pr-3 font-mono">{r.row_id.slice(0, 12)}</td>
            <td className="py-2 pr-3 font-mono">{r.operation}</td>
            <td className="py-2 pr-3 font-mono">{r.db_actor}</td>
            <td className="py-2 pr-3 font-mono text-zinc-500">
              {jsonPreview(r.after)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default async function AuditPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const params = (await searchParams) ?? {};
  const tab = asTab(params.tab);

  const reader = new PgAuditReader(getDb());

  let ontologyRows: AuditRow[] = [];
  let actionRows: AuditRow[] = [];
  let dataRows: DataAuditRow[] = [];

  if (tab === "ontology") {
    ontologyRows = await reader.listOntology({
      actor: params.actor || undefined,
      subject_type: params.subject_type || undefined,
    });
  } else if (tab === "action") {
    actionRows = await reader.listAction({
      actor: params.actor || undefined,
      subject_type: params.subject_type || undefined,
    });
  } else {
    dataRows = await reader.listData({
      table_name: params.table || undefined,
      operation: params.operation || undefined,
    });
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-8 py-12">
        <Link href="/ontology-editor" className="text-xs text-zinc-500 hover:text-zinc-300">
          ← ontology editor
        </Link>
        <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
          audit
        </h1>
        <p className="mt-1 text-xs text-zinc-500">
          three append-only logs: ontology mutations, action invocations, and
          per-row data audit (object types with{" "}
          <code className="font-mono">data_audit: true</code>).
        </p>

        <nav
          data-testid="audit-tabs"
          className="mt-8 flex gap-2 border-b border-zinc-800"
        >
          {TABS.map((t) => (
            <Link
              key={t}
              href={`/audit?tab=${t}`}
              data-active={tab === t ? "true" : undefined}
              className={
                tab === t
                  ? "border-b-2 border-emerald-400 px-3 py-2 text-sm font-medium text-emerald-300"
                  : "px-3 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200"
              }
            >
              {t}
            </Link>
          ))}
        </nav>

        <form
          method="get"
          action="/audit"
          className="mt-4 flex flex-wrap items-center gap-2 text-xs"
        >
          <input type="hidden" name="tab" value={tab} />
          {tab !== "data" ? (
            <>
              <input
                name="actor"
                defaultValue={params.actor ?? ""}
                placeholder="actor"
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100"
              />
              <input
                name="subject_type"
                defaultValue={params.subject_type ?? ""}
                placeholder="subject_type"
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100"
              />
            </>
          ) : (
            <>
              <input
                name="table"
                defaultValue={params.table ?? ""}
                placeholder="table_name"
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100"
              />
              <input
                name="operation"
                defaultValue={params.operation ?? ""}
                placeholder="INSERT/UPDATE/DELETE"
                className="rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100"
              />
            </>
          )}
          <button
            type="submit"
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium hover:bg-emerald-600"
          >
            filter
          </button>
        </form>

        {tab === "ontology" ? <OntologyTab rows={ontologyRows} /> : null}
        {tab === "action" ? <ActionTab rows={actionRows} /> : null}
        {tab === "data" ? <DataTab rows={dataRows} /> : null}
      </div>
    </main>
  );
}
