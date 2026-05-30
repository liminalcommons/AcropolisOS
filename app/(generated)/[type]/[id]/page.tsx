import Link from "next/link";
import { notFound } from "next/navigation";
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { prettify } from "@/lib/prettify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageProps {
  params: Promise<{ type: string; id: string }>;
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

  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) notFound();

  const ontology = await loadOntology(getRuntimeOntologyDir()).catch(
    () => null,
  );
  if (!ontology) notFound();
  const objectType = ontology.object_types[type];
  if (!objectType) notFound();

  const access = (chatRuntime.ctx.objects as Record<string, { findMany: () => Promise<Record<string, unknown>[]>; findById: (id: string) => Promise<Record<string, unknown> | null> }>)[type];
  if (!access) notFound();

  const row = await access.findById(id);
  if (!row) notFound();

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
      </div>
    </main>
  );
}
