import Link from "next/link";
import type { Ontology } from "@/lib/ontology/schema";
import { prettify } from "@/lib/prettify";
import { PromptButton } from "./prompt-button";

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
      className="min-h-full"
      data-state="seeded"
    >
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
        <div className="flex h-12 items-center gap-4 px-5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-sm bg-primary" />
            <span className="font-semibold tracking-tight">acropolisOS</span>
          </div>
          <span className="text-xs text-muted-foreground">
            {typeKeys.length} types · 0 entities · {actionCount} actions ·{" "}
            {linkCount} links
          </span>
          <div className="ml-auto flex items-center gap-3 text-xs">
            <Link
              href="/proposals"
              className="text-muted-foreground hover:text-foreground"
            >
              Proposals
            </Link>
            <Link
              href="/chat"
              className="text-muted-foreground hover:text-foreground"
            >
              Full chat
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1100px] px-6 py-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-primary">
            your world is ready
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">
            Add your first entities
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
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
                data-type={k}
                className="flex flex-col rounded-lg border border-border bg-card px-4 py-4 transition"
              >
                <Link
                  href={`/${k}`}
                  className="text-xs uppercase tracking-widest text-muted-foreground transition hover:text-foreground"
                >
                  {prettify(k)}
                </Link>
                <p className="mt-1 text-2xl font-semibold tracking-tight">0</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {description}
                </p>
                <PromptButton
                  prompt={`Help me add a ${prettify(k)}. Suggest reasonable starter values for: ${description}.`}
                  className="mt-3 self-start rounded text-left text-xs text-primary transition hover:text-primary/80"
                >
                  + add your first {prettify(k).toLowerCase()} →
                </PromptButton>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          With zero entities, the dashboard surfaces type cards first. Once you
          have data, this view collapses and live widgets take over.
        </p>
      </div>
    </main>
  );
}
