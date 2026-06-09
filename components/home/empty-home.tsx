import { PromptButton } from "./prompt-button";

// The core loop, made visible before any interaction. Domain-agnostic —
// this is the substrate's universal "what happens next?", not org-specific copy.
const JOURNEY_STEPS = [
  "Chat with agent",
  "Review proposal",
  "Approve",
  "Your board grows",
] as const;

const PROMPT_SEEDS: { label: string; prompt: string }[] = [
  {
    label: "A small housing co-op",
    prompt:
      "Set up an ontology for a small housing co-op — members, units, meetings, decisions. Propose the starter types.",
  },
  {
    label: "A monthly meditation group",
    prompt:
      "Set up an ontology for a monthly meditation group — members, sessions, attendance, notes. Propose the starter types.",
  },
  {
    label: "A volunteer fire brigade",
    prompt:
      "Set up an ontology for a volunteer fire brigade — members, shifts, incidents, equipment. Propose the starter types.",
  },
];

export function EmptyHome(): React.ReactElement {
  return (
    <main
      className="min-h-full"
      data-state="empty"
    >
      <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center px-6 pb-24 text-center">
        <p className="text-xs uppercase tracking-widest text-primary">
          acropolisOS · your world is empty
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          what do you want to track?
        </h1>
        <p className="mt-3 max-w-md text-sm text-muted-foreground">
          Tell the agent what your community is — members, assets, decisions —
          and it will propose a starter ontology you can accept or refine.
        </p>

        {/* User-journey breadcrumb — the core loop made visible up front. */}
        <ol
          data-journey="breadcrumb"
          className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs"
        >
          {JOURNEY_STEPS.map((step, i) => (
            <li
              key={step}
              className="flex items-center gap-2"
            >
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card/40 px-2.5 py-1 text-muted-foreground">
                <span className="font-mono text-[10px] text-primary">
                  {i + 1}
                </span>
                {step}
              </span>
              {i < JOURNEY_STEPS.length - 1 && (
                <span aria-hidden="true" className="text-muted-foreground/50">
                  →
                </span>
              )}
            </li>
          ))}
        </ol>

        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {PROMPT_SEEDS.map((seed) => (
            <PromptButton
              key={seed.label}
              prompt={seed.prompt}
              className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs text-primary transition hover:border-primary/60 hover:bg-primary/15"
            >
              {seed.label}
            </PromptButton>
          ))}
        </div>
        <p className="mt-8 text-xs text-muted-foreground">
          Type your community in the chat at the bottom of the screen.
        </p>
      </div>
    </main>
  );
}
