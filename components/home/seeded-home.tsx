import type { Ontology } from "@/lib/ontology/schema";

function prettify(key: string): string {
  return key
    .split("_")
    .map((w) => (w.length > 0 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function describeProps(
  props: Record<string, { description?: string }>,
): string {
  const labels = Object.keys(props).filter((k) => k !== "id");
  return labels.slice(0, 4).join(" · ");
}

interface SeededHomeProps {
  ontology: Ontology;
  typeKeys: string[];
  actionCount: number;
  linkCount: number;
}

export function SeededHome({
  ontology,
  typeKeys,
  actionCount,
  linkCount,
}: SeededHomeProps): React.ReactElement {
  return (
    <main
      className="min-h-screen bg-zinc-950 text-zinc-100"
      data-state="seeded"
    >
      <header className="sticky top-0 z-30 border-b border-zinc-900 bg-zinc-950/85 backdrop-blur">
        <div className="flex h-12 items-center gap-4 px-5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-sm bg-violet-400" />
            <span className="font-semibold tracking-tight">acropolisOS</span>
          </div>
          <span className="text-xs text-zinc-500">
            {typeKeys.length} types · 0 entities · {actionCount} actions ·{" "}
            {linkCount} links
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-[1100px] px-6 py-8">
        <div className="mb-6">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-400">
            your world is ready
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Add your first entities
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            The ontology is seeded with starter types. Ask the agent to populate
            them, or invoke an action through the chat.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {typeKeys.map((k) => {
            const t = ontology.object_types[k];
            const description = t ? describeProps(t.properties) : "";
            return (
              <div
                key={k}
                data-testid={`type-card-${k}`}
                className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-4"
              >
                <p className="text-[10px] uppercase tracking-widest text-zinc-500">
                  {prettify(k)}
                </p>
                <p className="mt-1 text-2xl font-semibold tracking-tight">0</p>
                <p className="mt-1 truncate text-[11px] text-zinc-500">
                  {description}
                </p>
                <p className="mt-3 text-[10px] text-violet-300">
                  + add your first {prettify(k).toLowerCase()} →
                </p>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-[11px] text-zinc-500">
          With zero entities, the dashboard surfaces type cards first. Once you
          have data, this view collapses and live widgets take over.
        </p>
      </div>
    </main>
  );
}
