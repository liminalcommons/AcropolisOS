import Link from "next/link";
import { notFound } from "next/navigation";
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";
import { pascalToSnake } from "@/lib/ontology/casing";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { prettify } from "@/lib/prettify";
import { buildCanWriteType } from "@/lib/widgets/write-api";
import { deriveFormFields } from "@/lib/ontology/object-form";
import { ObjectForm, DeleteButton } from "@/components/generated/ObjectForm";
import { updateObjectAction, deleteObjectAction } from "../actions";

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
  const { type: typeParam, id } = await params;
  if (!isValidIdent(typeParam)) notFound();

  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) notFound();

  const ontology = await loadOntology(getRuntimeOntologyDir()).catch(
    () => null,
  );
  if (!ontology) notFound();
  // Accept the PascalCase key or the snake token (board cards link with the token).
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

  const row = await access.findById(id);
  if (!row) notFound();

  const canWrite = buildCanWriteType(chatRuntime.actor, ontology)(pascalToSnake(type));
  const formFields = deriveFormFields(ontology, type);

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

        {canWrite && formFields.length > 0 ? (
          <div className="mt-8 space-y-6">
            <details className="rounded-md border border-border bg-card/20 p-4">
              <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
                Edit {prettify(type)}
              </summary>
              <div className="mt-4">
                <ObjectForm
                  fields={formFields}
                  initial={row}
                  submitLabel="Save changes"
                  action={updateObjectAction.bind(null, type, id)}
                  afterSuccessHref={`/${type}/${id}`}
                />
              </div>
            </details>
            <div className="flex items-center gap-3">
              <DeleteButton
                action={deleteObjectAction.bind(null, type, id)}
                afterHref={`/${type}`}
                label={`Delete this ${prettify(type)}`}
              />
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
