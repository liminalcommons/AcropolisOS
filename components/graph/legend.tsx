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

// Pending-growth accent — literal amber (same hue as confirm_if_unfamiliar) for
// proposed nodes/edges overlaid on the committed ontology. Literal oklch for the
// same reason as POLICY_VAR. PROPOSED_TINT carries an alpha for fills/rings; the
// renderer derives the ring by swapping its 0.12 alpha for 0.5.
export const PROPOSED_COLOR = "oklch(0.78 0.14 80)";
export const PROPOSED_TINT = "oklch(0.78 0.14 80 / 0.12)";

export function Legend({ proposedCount = 0 }: { proposedCount?: number }): React.ReactElement {
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
      <p className="mt-3 mb-1 font-medium text-foreground">
        Growth {proposedCount > 0 && <span style={{ color: PROPOSED_COLOR }}>· {proposedCount} pending</span>}
      </p>
      <ul className="space-y-1">
        <li className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ border: `1.5px dashed ${PROPOSED_COLOR}`, backgroundColor: PROPOSED_TINT }}
          />
          proposed type (awaiting your approval)
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ boxShadow: `0 0 0 2px ${PROPOSED_COLOR}` }} />
          existing type gaining fields
        </li>
      </ul>
      <p className="mt-3 mb-1 font-medium text-foreground">Edges</p>
      <ul className="space-y-1">
        <li>— line: relation between objects</li>
        <li style={{ color: PROPOSED_COLOR }}>┄ dashed: proposed link</li>
      </ul>
    </div>
  );
}
