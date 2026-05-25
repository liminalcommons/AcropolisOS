import { PromptButton } from "./prompt-button";

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
