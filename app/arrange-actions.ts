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
  addableForRole,
} from "@/lib/widgets/arrange";

async function resolveMember() {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) throw new Error("unauthorized");
  const db = getDb();
  const rows = await db
    .select({ id: memberTable.id, tier_role: memberTable.tier_role })
    .from(memberTable)
    .where(eq(memberTable.id, runtime.actor.userId))
    .limit(1);
  if (rows.length === 0) throw new Error("no_member_row");
  return { db, member: rows[0] };
}

export async function moveWidgetAction(id: string, dir: "up" | "down"): Promise<void> {
  const { db, member } = await resolveMember();
  const next = moveItem(await currentArrangement(db, member), id, dir);
  await compose_dashboard(db, member.id, toSelections(next));
  revalidatePath("/");
}

export async function removeWidgetAction(id: string): Promise<void> {
  const { db, member } = await resolveMember();
  const next = removeItem(await currentArrangement(db, member), id);
  await compose_dashboard(db, member.id, toSelections(next));
  revalidatePath("/");
}

// index is the position in addableForRole(role); resolved server-side so the
// client never sends a config blob (governance: arrange within the catalog).
export async function addWidgetAction(addableIndex: number): Promise<void> {
  const { db, member } = await resolveMember();
  const menu = addableForRole(member.tier_role);
  const sel = menu[addableIndex];
  if (!sel) throw new Error("invalid_addable_index");
  const next = addItem(await currentArrangement(db, member), sel);
  await compose_dashboard(db, member.id, toSelections(next));
  revalidatePath("/");
}

export async function resetArrangementAction(): Promise<void> {
  const { db, member } = await resolveMember();
  // Empty pins → resolvePerUserDashboard falls back to the role-default floor.
  await compose_dashboard(db, member.id, []);
  revalidatePath("/");
}
