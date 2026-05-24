// M4.3: MemberContext get-or-create helper.
// Auto-creates the row on first access (idempotent). Used by /me page and
// query_member_context tool. The ctx must be scoped to an actor who can write
// MemberContext (member_self via member_id, or steward).

import { randomUUID } from "node:crypto";
import type { OntologyCtx } from "@/lib/ontology/ctx";
import type { MemberContext } from "@/lib/ontology/types.generated";

const DEFAULT_PINNED_WIDGETS = "[]";

export async function getOrCreateMemberContext(
  ctx: OntologyCtx,
  memberId: string,
): Promise<MemberContext> {
  // findMany returns only rows the actor can see (permission wrapper).
  const all = await ctx.objects.MemberContext.findMany();
  const existing = all.find((r) => r.member_id === memberId);
  if (existing) return existing;

  // No accessible row — create one. The permission wrapper will deny creation
  // if the actor doesn't have write access (member_self or steward).
  const now = new Date().toISOString();
  const row = await ctx.objects.MemberContext.create({
    id: randomUUID(),
    member_id: memberId,
    pinned_widgets: DEFAULT_PINNED_WIDGETS,
    created_at: now,
    updated_at: now,
  });
  return row;
}
