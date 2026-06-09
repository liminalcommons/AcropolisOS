// M4.1 step-5: /inbox — current user's notification inbox.
//
// Server component. Resolves the actor via the chat-runtime (same path
// chat + apply use) so the recipient_member_id filter is always the
// authenticated user's id; falls back to the steward-local sentinel in
// dev. Lists newest first. Each row has a "Mark read" form button that
// invokes the mark_notification_read action through the full audit
// pipeline; the page header has a "Mark all read" affordance. Look
// matches /audit.

import Link from "next/link";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { PgNotificationStore } from "@/lib/notifications/store";
import { getDb } from "@/lib/db/client";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "./actions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fmtTime(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 19);
}

export default async function InboxPage(): Promise<React.ReactElement> {
  // Middleware enforces auth; no redirect needed here — middleware intercepts before page renders.
  const chatRuntime = await buildChatRuntime();
  // M3.8 (#37): isAnonymous guard kept as type-narrowing; middleware already blocked anon callers.
  if (isAnonymous(chatRuntime.actor)) {
    // unreachable: middleware redirects to /signin before this executes
    return <></>;
  }
  // actor is guaranteed non-anonymous here; pass it so
  // the store-level permission check (#27) can enforce member_self / steward.
  const actor = chatRuntime.actor!;
  const recipientId = actor.userId;
  const store = new PgNotificationStore(getDb());
  const rows = await store.listForRecipient(actor, recipientId);
  const unread = rows.filter((r) => r.read_at === null).length;

  return (
    <main className="min-h-full">
      <div className="mx-auto max-w-4xl px-8 py-12">
        <Link href="/ontology-editor" className="text-xs text-muted-foreground hover:text-foreground">
          ← ontology editor
        </Link>
        <div className="mt-1 flex items-baseline justify-between">
          <div>
            <h1 className="font-mono text-2xl font-semibold tracking-tight">
              inbox
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Notifications delivered to you by the notify_member side-effect.
              Newest first. {rows.length} row(s) · {unread} unread.
            </p>
          </div>
          {unread > 0 ? (
            <form action={markAllNotificationsReadAction}>
              <button
                type="submit"
                data-testid="mark-all-read"
                className="rounded-md bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-card/80"
              >
                Mark all read
              </button>
            </form>
          ) : null}
        </div>

        {rows.length === 0 ? (
          <p className="mt-12 text-sm text-muted-foreground">
            No notifications yet. Actions that declare notify_member will
            drop rows here.
          </p>
        ) : (
          <ul
            data-testid="inbox-list"
            className="mt-8 divide-y divide-border rounded-md border border-border"
          >
            {rows.map((r) => {
              const isUnread = r.read_at === null;
              return (
                <li
                  key={r.id}
                  data-testid={`inbox-row-${r.id}`}
                  data-state={isUnread ? "unread" : "read"}
                  className={
                    isUnread
                      ? "bg-card/40 px-4 py-3"
                      : "px-4 py-3 opacity-60"
                  }
                >
                  <div className="flex items-baseline justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {isUnread ? (
                          <span
                            aria-label="unread"
                            className="inline-block h-2 w-2 rounded-full bg-primary"
                          />
                        ) : null}
                        <span className="truncate font-medium text-sm text-foreground">
                          {r.title}
                        </span>
                        <span className="text-xs uppercase tracking-widest text-muted-foreground">
                          {r.kind}
                        </span>
                      </div>
                      {r.link_url ? (
                        <div className="mt-2">
                          <Link
                            href={r.link_url}
                            className="text-xs text-success hover:text-emerald-300"
                          >
                            open →
                          </Link>
                        </div>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-right">
                      <time
                        dateTime={r.created_at.toISOString()}
                        className="block font-mono text-xs text-muted-foreground"
                      >
                        {fmtTime(r.created_at)}
                      </time>
                      {isUnread ? (
                        <form
                          action={markNotificationReadAction.bind(null, r.id)}
                          className="mt-2"
                        >
                          <button
                            type="submit"
                            data-testid={`mark-read-${r.id}`}
                            className="rounded-md bg-emerald-700 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-emerald-600"
                          >
                            Mark read
                          </button>
                        </form>
                      ) : (
                        <span className="mt-2 inline-block text-xs text-muted-foreground/60">
                          read {fmtTime(r.read_at!)}
                        </span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
