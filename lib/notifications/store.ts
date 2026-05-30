// M4.1: notification (inbox) store.
//
// Purpose-specific data layer for in-app inbox rows. Sits alongside the
// OntologyStore (lib/ontology/pg-store.ts) rather than inside it, because
// the inbox needs query shapes the generic ObjectAccess doesn't provide:
// listForRecipient (newest first), unreadCount, markRead, markAllRead.
//
// Persisted rows live in the `notification` table generated from
// scenarios/small-community/ontology/object-types/notification.yaml — see
// lib/db/schema.generated.ts.
//
// M4.1 cleanup (#27): listForRecipient / markRead / unreadCount now require
// an Actor and enforce: actor.userId === recipientMemberId OR actor.role ===
// "steward". This is defense-in-depth — the /inbox route already refuses
// anonymous (M3.8 #37) and markRead goes through the audit pipeline — but
// the store-level check ensures no code path can bypass the OntologyStore
// permission wrappers by calling the store directly.

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Database } from "../db/client";
import { notification as notificationTable } from "../db/schema.generated";
import type { Actor } from "../ctx";

// Thrown when an actor attempts to read or mutate another member's notifications
// without steward privileges.
export class NotificationPermissionError extends Error {
  readonly code = "NOTIFICATION_PERMISSION_DENIED" as const;
  constructor(actorId: string, recipientId: string) {
    super(
      `Actor '${actorId}' is not permitted to access notifications for recipient '${recipientId}'. Must be the recipient or a steward.`,
    );
    this.name = "NotificationPermissionError";
  }
}

function assertActorMayRead(actor: Actor, recipientMemberId: string): void {
  if (
    actor.role !== "steward" &&
    actor.userId !== recipientMemberId
  ) {
    throw new NotificationPermissionError(actor.userId, recipientMemberId);
  }
}

export interface NotificationRow {
  id: string;
  recipient_member_id: string;
  kind: string;
  title: string;
  body: string;
  link_url: string | null;
  created_at: Date;
  read_at: Date | null;
}

export interface NotificationCreateInput {
  recipient_member_id: string;
  kind: string;
  title: string;
  body: string;
  link_url?: string | null;
}

export interface NotificationStore {
  create(input: NotificationCreateInput): Promise<NotificationRow>;
  /** Requires actor.userId === recipientMemberId OR actor.role === "steward". */
  listForRecipient(actor: Actor, recipientMemberId: string): Promise<NotificationRow[]>;
  /** Requires actor.userId === recipientMemberId OR actor.role === "steward". */
  unreadCount(actor: Actor, recipientMemberId: string): Promise<number>;
  /** Requires actor.userId === recipientMemberId OR actor.role === "steward". */
  markRead(actor: Actor, id: string, recipientMemberId: string): Promise<NotificationRow | null>;
  markAllRead(recipientMemberId: string): Promise<number>;
  findById(id: string): Promise<NotificationRow | null>;
}

export class InMemoryNotificationStore implements NotificationStore {
  private readonly rows: NotificationRow[] = [];

  async create(input: NotificationCreateInput): Promise<NotificationRow> {
    const row: NotificationRow = {
      id: randomUUID(),
      recipient_member_id: input.recipient_member_id,
      kind: input.kind,
      title: input.title,
      body: input.body,
      link_url: input.link_url ?? null,
      created_at: new Date(),
      read_at: null,
    };
    this.rows.push(row);
    return { ...row };
  }

  async listForRecipient(actor: Actor, recipientMemberId: string): Promise<NotificationRow[]> {
    assertActorMayRead(actor, recipientMemberId);
    return this.rows
      .filter((r) => r.recipient_member_id === recipientMemberId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
      .map((r) => ({ ...r }));
  }

  async unreadCount(actor: Actor, recipientMemberId: string): Promise<number> {
    assertActorMayRead(actor, recipientMemberId);
    return this.rows.filter(
      (r) => r.recipient_member_id === recipientMemberId && r.read_at === null,
    ).length;
  }

  async markRead(
    actor: Actor,
    id: string,
    recipientMemberId: string,
  ): Promise<NotificationRow | null> {
    assertActorMayRead(actor, recipientMemberId);
    const row = this.rows.find(
      (r) => r.id === id && r.recipient_member_id === recipientMemberId,
    );
    if (!row) return null;
    row.read_at = row.read_at ?? new Date();
    return { ...row };
  }

  async markAllRead(recipientMemberId: string): Promise<number> {
    let n = 0;
    const now = new Date();
    for (const r of this.rows) {
      if (r.recipient_member_id === recipientMemberId && r.read_at === null) {
        r.read_at = now;
        n += 1;
      }
    }
    return n;
  }

  async findById(id: string): Promise<NotificationRow | null> {
    const row = this.rows.find((r) => r.id === id);
    return row ? { ...row } : null;
  }
}

function mapRow(
  r: typeof notificationTable.$inferSelect,
): NotificationRow {
  return {
    id: r.id,
    recipient_member_id: r.recipient_member_id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    link_url: r.link_url ?? null,
    created_at:
      r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
    read_at:
      r.read_at === null || r.read_at === undefined
        ? null
        : r.read_at instanceof Date
          ? r.read_at
          : new Date(r.read_at),
  };
}

export class PgNotificationStore implements NotificationStore {
  constructor(private readonly db: Database) {}

  async create(input: NotificationCreateInput): Promise<NotificationRow> {
    const now = new Date();
    const [row] = await this.db
      .insert(notificationTable)
      .values({
        recipient_member_id: input.recipient_member_id,
        kind: input.kind,
        title: input.title,
        body: input.body,
        link_url: input.link_url ?? null,
        created_at: now,
        read_at: null,
      })
      .returning();
    return mapRow(row);
  }

  async listForRecipient(actor: Actor, recipientMemberId: string): Promise<NotificationRow[]> {
    assertActorMayRead(actor, recipientMemberId);
    const rows = await this.db
      .select()
      .from(notificationTable)
      .where(eq(notificationTable.recipient_member_id, recipientMemberId))
      .orderBy(desc(notificationTable.created_at));
    return rows.map(mapRow);
  }

  async unreadCount(actor: Actor, recipientMemberId: string): Promise<number> {
    assertActorMayRead(actor, recipientMemberId);
    const rows = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notificationTable)
      .where(
        and(
          eq(notificationTable.recipient_member_id, recipientMemberId),
          isNull(notificationTable.read_at),
        ),
      );
    const n = rows[0]?.n;
    return typeof n === "number" ? n : Number(n ?? 0);
  }

  async markRead(
    actor: Actor,
    id: string,
    recipientMemberId: string,
  ): Promise<NotificationRow | null> {
    assertActorMayRead(actor, recipientMemberId);
    const [row] = await this.db
      .update(notificationTable)
      .set({ read_at: new Date() })
      .where(
        and(
          eq(notificationTable.id, id),
          eq(notificationTable.recipient_member_id, recipientMemberId),
          isNull(notificationTable.read_at),
        ),
      )
      .returning();
    if (row) return mapRow(row);
    // The row may already be read or owned by someone else; fall through to
    // a plain ownership check so the caller can distinguish "not found" from
    // "already read".
    const [existing] = await this.db
      .select()
      .from(notificationTable)
      .where(
        and(
          eq(notificationTable.id, id),
          eq(notificationTable.recipient_member_id, recipientMemberId),
        ),
      )
      .limit(1);
    return existing ? mapRow(existing) : null;
  }

  async markAllRead(recipientMemberId: string): Promise<number> {
    const rows = await this.db
      .update(notificationTable)
      .set({ read_at: new Date() })
      .where(
        and(
          eq(notificationTable.recipient_member_id, recipientMemberId),
          isNull(notificationTable.read_at),
        ),
      )
      .returning({ id: notificationTable.id });
    return rows.length;
  }

  async findById(id: string): Promise<NotificationRow | null> {
    const [row] = await this.db
      .select()
      .from(notificationTable)
      .where(eq(notificationTable.id, id))
      .limit(1);
    return row ? mapRow(row) : null;
  }
}
