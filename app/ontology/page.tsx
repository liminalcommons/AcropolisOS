import Link from "next/link";
import { loadOntology } from "@/lib/ontology/load";
import { getRuntimeOntologyDir } from "@/lib/setup/paths";

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
  const ontologyRoot = getRuntimeOntologyDir();
  const ontology = await loadOntology(ontologyRoot);

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
    <main className="min-h-full">
      <div className="mx-auto max-w-6xl px-8 py-12">
        <div className="flex items-baseline justify-between">
          <div>
            <Link
              href="/ontology-editor"
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ← ontology editor
            </Link>
            <h1 className="mt-1 font-mono text-2xl font-semibold tracking-tight">
              ontology
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {objectTypeRows.length} object type
              {objectTypeRows.length === 1 ? "" : "s"} · {linkTypeRows.length}{" "}
              link type{linkTypeRows.length === 1 ? "" : "s"} ·{" "}
              {sharedPropertyRows.length} shared propert
              {sharedPropertyRows.length === 1 ? "y" : "ies"}
            </p>
          </div>
          <Link
            href="/ontology-editor"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Ontology editor →
          </Link>
        </div>

        <section className="mt-8">
          <Link
            href="/graph"
            className="flex items-center justify-between rounded-md border border-border bg-card/50 p-4 transition-colors hover:border-primary/60"
          >
            <span>
              <span className="block text-sm font-semibold text-foreground">
                Interactive graph →
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                See objects, relations, and the actions the AI may run — colored by
                whether each needs human confirmation.
              </span>
            </span>
          </Link>
        </section>

        <section className="mt-10 grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Object types
            </h2>
            <ul
              data-testid="ontology-object-types"
              className="mt-2 space-y-3"
            >
              {objectTypeRows.map((ot) => (
                <li
                  key={ot.name}
                  className="rounded-md border border-border bg-card/50 p-3"
                >
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-mono text-sm font-semibold text-foreground">
                      {ot.name}
                    </h3>
                    <span className="text-xs text-muted-foreground">
                      {ot.properties.length} props
                    </span>
                  </div>
                  {ot.description ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {ot.description}
                    </p>
                  ) : null}
                  <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {ot.properties.map((p) => (
                      <li
                        key={p.name}
                        className="flex justify-between text-foreground"
                      >
                        <span className="font-mono">{p.name}</span>
                        <span className="text-muted-foreground">{p.body}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-8">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Link types
              </h2>
              <ul
                data-testid="ontology-link-types"
                className="mt-2 space-y-2"
              >
                {linkTypeRows.map((lt) => (
                  <li
                    key={lt.name}
                    className="rounded-md border border-border bg-card/50 p-3 text-xs"
                  >
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-sm font-semibold text-foreground">
                        {lt.name}
                      </span>
                      <span className="text-muted-foreground">{lt.cardinality}</span>
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      <span className="font-mono">{lt.from}</span>{" "}
                      <span className="text-muted-foreground/60">→</span>{" "}
                      <span className="font-mono">{lt.to}</span>
                    </div>
                    {lt.description ? (
                      <p className="mt-1 text-muted-foreground">{lt.description}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Shared properties
              </h2>
              <ul
                data-testid="ontology-shared-properties"
                className="mt-2 space-y-1"
              >
                {sharedPropertyRows.map((sp) => (
                  <li
                    key={sp.name}
                    className="flex justify-between rounded-md border border-border bg-card/50 px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-foreground">{sp.name}</span>
                    <span className="text-muted-foreground">{sp.type}</span>
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
