// lib/widgets/arrange.ts
import { randomUUID } from "node:crypto";
import type { Database } from "@/lib/db/client";
import type { CatalogKind } from "./catalog";
import { type WidgetSelection } from "./compose";
import { resolvePerUserDashboard } from "./per-user";
import { deriveDefaultBoard } from "./derive-board";
import { type CanReadType } from "./read-api";
import type { Ontology } from "@/lib/ontology/schema";

export interface ArrangeItem {
  id: string;
  kind: CatalogKind;
  config: unknown;
}

export function moveItem(items: ArrangeItem[], id: string, dir: "up" | "down"): ArrangeItem[] {
  const idx = items.findIndex((i) => i.id === id);
  if (idx === -1) return items;
  const target = dir === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= items.length) return items;
  const next = items.slice();
  [next[idx], next[target]] = [next[target], next[idx]];
  return next;
}

export function removeItem(items: ArrangeItem[], id: string): ArrangeItem[] {
  if (!items.some((i) => i.id === id)) return items;
  return items.filter((i) => i.id !== id);
}

export function addItem(items: ArrangeItem[], sel: WidgetSelection): ArrangeItem[] {
  return [...items, { id: randomUUID(), kind: sel.kind, config: sel.config }];
}

export function toSelections(items: ArrangeItem[]): WidgetSelection[] {
  return items.map(({ kind, config }) => ({ kind, config }));
}

// The widgets a viewer may add to their dashboard = the derived default board
// for what they can read (permission-lens). No role curation; no hostel literals.
export function addableWidgets(ontology: Ontology, canReadType: CanReadType): WidgetSelection[] {
  return deriveDefaultBoard(ontology, canReadType).map((d) => ({ kind: d.kind, config: d.config }));
}

// Server-authoritative current arrangement: derive from the resolved dashboard
// (reflects explicit pins, or the permission-scoped derived default) and keep
// ids+config.
export async function currentArrangement(
  db: Database,
  member: { id: string; tier_role: string },
  canReadType: CanReadType,
): Promise<ArrangeItem[]> {
  const resolved = await resolvePerUserDashboard(db, member, canReadType);
  return resolved.map((w) => ({ id: w.id, kind: w.kind, config: w.config }));
}
