// §4.1 merge: approved governed views layer OVER the deterministic floor.
// Precedence (low→high): derived floor < approved_views < explicit user pins.
// This file handles floor < approved. Pins are handled upstream in per-user.ts
// (explicit non-empty pinned_widgets short-circuit before the floor is derived).
//
// Each floor descriptor gets a stable id "derived-<index>" so an approved view
// can REPLACE a specific floor slot by id; otherwise approved descriptors append.
import type { SliceDescriptor } from "@/lib/widgets/derive-board";
import type { ApprovedViewDescriptor } from "./registry";

export type MergedDescriptor = ApprovedViewDescriptor;

export function mergeApprovedIntoFloor(
  floor: SliceDescriptor[],
  approved: ApprovedViewDescriptor[],
): MergedDescriptor[] {
  const merged: MergedDescriptor[] = floor.map((d, i) => ({
    id: `derived-${i}`,
    kind: d.kind,
    config: d.config,
    title: d.title,
  }));
  const byId = new Map(merged.map((d) => [d.id, d] as const));
  for (const a of approved) {
    if (byId.has(a.id)) {
      const idx = merged.findIndex((d) => d.id === a.id);
      merged[idx] = a;
      byId.set(a.id, a);
    } else {
      merged.push(a);
      byId.set(a.id, a);
    }
  }
  return merged;
}
