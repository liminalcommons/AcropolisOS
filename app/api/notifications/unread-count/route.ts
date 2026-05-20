// M4.1 step-6: tiny unread-count endpoint for the chat panel header badge.
//
// Returns { count: number } for the authenticated actor. Anonymous /
// no-actor requests get count=0 — the chat panel doesn't render the badge
// in that case anyway, but returning 0 is friendlier than a 401 that the
// fetcher would have to special-case.
//
// M4.1 cleanup (#27): pass the resolved actor into store.unreadCount so
// the store-level permission check enforces member_self / steward.

import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db/client";
import { PgNotificationStore } from "@/lib/notifications/store";
import type { Actor } from "@/lib/ctx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  try {
    const session = await auth().catch(() => null);
    const userInfo = session?.user as
      | { userId?: string; email?: string; role?: string }
      | undefined;
    const userId = userInfo?.userId ? String(userInfo.userId) : null;
    if (!userId) {
      return Response.json({ count: 0 });
    }
    const actor: Actor = {
      userId,
      email: String(userInfo?.email ?? ""),
      role: userInfo?.role === "steward" ? "steward" : "member",
      customRoles: [],
    };
    const store = new PgNotificationStore(getDb());
    const count = await store.unreadCount(actor, userId);
    return Response.json({ count });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[api/notifications/unread-count] ${msg}`);
    return Response.json({ count: 0 }, { status: 200 });
  }
}
