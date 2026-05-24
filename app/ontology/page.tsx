import path from "node:path";
import Link from "next/link";
import { loadOntology } from "@/lib/ontology/load";
import { ontologyToGraph } from "@/lib/ontology/schema-graph";
import { SchemaGraphView } from "@/components/ontology/schema-graph";

export const dynamic = "force-dynamic";

interface PropertySummary {
  name: string;
  body: string;
}

function summarizeProperty(body: unknown): string {
  if (body && typeof body === "object" && "ref" in body) {
    return `→ ${(body as { ref: string }).ref}`;
  }
  if (body && typeof body === "object" && "type" in body) {
    return String((body as { type: string }).type);
  }
  return "?";
}

export default async function OntologyPage(): Promise<React.ReactElement> {
  const ontologyRoot = path.join(process.cwd(), "ontology");
  const ontology = await loadOntology(ontologyRoot);
  const graph = ontologyToGraph(ontology);

  const objectTypeRows = Object.entries(ontology.object_types).map(
    ([name, body]) => ({
      name,
      description: body.description ?? "",
      properties: Object.entries(body.properties).map(
        ([pname, pbody]): PropertySummary => ({
          name: pname,
          body: summarizeProperty(pbody),
        }),
      ),
    }),
  );

  const linkTypeRows = Object.entries(ontology.link_types).map(
    ([name, body]) => ({
      name,
      from: body.from,
      to: body.to,
      cardinality: body.cardinality,
      description: body.description ?? "",
    }),
  );

  const sharedPropertyRows = Object.entries(ontology.properties).map(
    ([name, body]) => ({
      name,
      type: body.type,
      description: ("description" in body ? body.description : "") ?? "",
    }),
  );

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-6xl px-8 py-12">
        <div className="flex items-baseline justify-between">
          <div>
            <Link
              href="/ontology-editor"
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              ← ontology editor
            </Link>
            <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
              ontology
            </h1>
            <p className="mt-1 text-xs text-zinc-500">
              {objectTypeRows.length} object type
              {objectTypeRows.length === 1 ? "" : "s"} · {linkTypeRows.length}{" "}
              link type{linkTypeRows.length === 1 ? "" : "s"} ·{" "}
              {sharedPropertyRows.length} shared propert
              {sharedPropertyRows.length === 1 ? "y" : "ies"}
            </p>
          </div>
          <Link
            href="/ontology-editor"
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Ontology editor →
          </Link>
        </div>

        <section className="mt-8">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
            Schema graph
          </h2>
          <div className="mt-2">
            <SchemaGraphView graph={graph} />
          </div>
        </section>

        <section className="mt-10 grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
              Object types
            </h2>
            <ul
              data-testid="ontology-object-types"
              className="mt-2 space-y-3"
            >
              {objectTypeRows.map((ot) => (
                <li
                  key={ot.name}
                  className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3"
                >
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-mono text-sm font-semibold text-zinc-100">
                      {ot.name}
                    </h3>
                    <span className="text-xs text-zinc-500">
                      {ot.properties.length} props
                    </span>
                  </div>
                  {ot.description ? (
                    <p className="mt-1 text-xs text-zinc-400">
                      {ot.description}
                    </p>
                  ) : null}
                  <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {ot.properties.map((p) => (
                      <li
                        key={p.name}
                        className="flex justify-between text-zinc-300"
                      >
                        <span className="font-mono">{p.name}</span>
                        <span className="text-zinc-500">{p.body}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-8">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Link types
              </h2>
              <ul
                data-testid="ontology-link-types"
                className="mt-2 space-y-2"
              >
                {linkTypeRows.map((lt) => (
                  <li
                    key={lt.name}
                    className="rounded-md border border-zinc-800 bg-zinc-900/50 p-3 text-xs"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-sm font-semibold text-zinc-100">
                        {lt.name}
                      </span>
                      <span className="text-zinc-500">{lt.cardinality}</span>
                    </div>
                    <div className="mt-1 text-zinc-400">
                      <span className="font-mono">{lt.from}</span>{" "}
                      <span className="text-zinc-600">→</span>{" "}
                      <span className="font-mono">{lt.to}</span>
                    </div>
                    {lt.description ? (
                      <p className="mt-1 text-zinc-500">{lt.description}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-400">
                Shared properties
              </h2>
              <ul
                data-testid="ontology-shared-properties"
                className="mt-2 space-y-1"
              >
                {sharedPropertyRows.map((sp) => (
                  <li
                    key={sp.name}
                    className="flex justify-between rounded-md border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-zinc-200">{sp.name}</span>
                    <span className="text-zinc-500">{sp.type}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
