// app/arrange-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { member as memberTable } from "@/lib/db/schema.generated";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { compose_dashboard } from "@/lib/widgets/compose";
import {
  currentArrangement,
  moveItem,
  removeItem,
  addItem,
  toSelections,
  addableWidgets,
} from "@/lib/widgets/arrange";
import { buildCanReadType, type CanReadType } from "@/lib/widgets/read-api";
import { PgApprovedViewsRegistry } from "@/lib/views/registry-pg";
import type { ApprovedViewsRegistry } from "@/lib/views/registry";
import type { Ontology } from "@/lib/ontology/schema";

async function resolveMember(): Promise<{
  db: ReturnType<typeof getDb>;
  member: { id: string; tier_role: string };
  canReadType: CanReadType;
  registry: ApprovedViewsRegistry;
  ontology: Ontology;
}> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) throw new Error("unauthorized");
  const db = getDb();
  const rows = await db
    .select({ id: memberTable.id, tier_role: memberTable.tier_role })
    .from(memberTable)
    .where(eq(memberTable.id, runtime.actor.userId))
    .limit(1);
  if (rows.length === 0) throw new Error("no_member_row");
  // SECURITY: gate widget reads by the SESSION actor's per-type read permission.
  const canReadType = buildCanReadType(runtime.actor, runtime.ontology);
  return {
    db,
    member: rows[0],
    canReadType,
    registry: new PgApprovedViewsRegistry(db),
    ontology: runtime.ontology,
  };
}

// Selections here are always catalog-valid by construction (derived from
// resolvePerUserDashboard or deriveDefaultBoard), so a validation_error means an
// invariant broke — surface it instead of silently revalidating to stale state.
async function persist(
  db: Awaited<ReturnType<typeof resolveMember>>["db"],
  memberId: string,
  next: Parameters<typeof compose_dashboard>[2],
): Promise<void> {
  const res = await compose_dashboard(db, memberId, next);
  if (res.status !== "ok") {
    throw new Error(`compose_failed: ${JSON.stringify(res.errors)}`);
  }
  revalidatePath("/");
}

export async function moveWidgetAction(id: string, dir: "up" | "down"): Promise<void> {
  const { db, member, canReadType, registry } = await resolveMember();
  const next = moveItem(await currentArrangement(db, member, canReadType, registry), id, dir);
  await persist(db, member.id, toSelections(next));
}

export async function removeWidgetAction(id: string): Promise<void> {
  const { db, member, canReadType, registry } = await resolveMember();
  const next = removeItem(await currentArrangement(db, member, canReadType, registry), id);
  await persist(db, member.id, toSelections(next));
}

// index is the position in addableWidgets(ontology, canReadType); resolved
// server-side so the client never sends a config blob (governance: arrange
// within the permission-scoped derived catalog).
export async function addWidgetAction(addableIndex: number): Promise<void> {
  const { db, member, canReadType, registry, ontology } = await resolveMember();
  const menu = addableWidgets(ontology, canReadType);
  const sel = menu[addableIndex];
  if (!sel) throw new Error("invalid_addable_index");
  const next = addItem(await currentArrangement(db, member, canReadType, registry), sel);
  await persist(db, member.id, toSelections(next));
}

export async function resetArrangementAction(): Promise<void> {
  const { db, member } = await resolveMember();
  // Empty pins → resolvePerUserDashboard falls back to the derived (permission-scoped) floor.
  await persist(db, member.id, []);
}
