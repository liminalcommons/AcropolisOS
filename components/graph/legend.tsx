import type { AgentPolicy } from "@/lib/ontology/schema";

export const POLICY_LABEL: Record<AgentPolicy, string> = {
  auto_apply: "AI runs autonomously",
  confirm_if_unfamiliar: "AI confirms if unfamiliar",
  always_confirm: "AI always confirms with a human",
};

// Fixed domain legend — these three policy colors are not user-themeable, so
// they are literal oklch values. The app applies its theme as inline CSS vars on
// #app-shell-root and does not carry policy colors, so a CSS var would not resolve.
export const POLICY_VAR: Record<AgentPolicy, string> = {
  auto_apply: "oklch(0.7 0.15 150)",
  confirm_if_unfamiliar: "oklch(0.78 0.14 80)",
  always_confirm: "oklch(0.62 0.2 28)",
};

export function Legend(): React.ReactElement {
  return (
    <div className="rounded-lg border border-border bg-card/90 p-3 text-xs text-muted-foreground backdrop-blur">
      <p className="mb-2 font-medium text-foreground">What the AI may do</p>
      <ul className="space-y-1">
        {(Object.keys(POLICY_LABEL) as AgentPolicy[]).map((p) => (
          <li key={p} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: POLICY_VAR[p] }} />
            {POLICY_LABEL[p]}
          </li>
        ))}
      </ul>
      <p className="mt-3 mb-1 font-medium text-foreground">Edges</p>
      <ul className="space-y-1">
        <li>— line: relation between objects</li>
      </ul>
    </div>
  );
}
