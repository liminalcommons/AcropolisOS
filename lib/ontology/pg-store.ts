// M2.2 step-2: Postgres-backed OntologyStore.
//
// Implements the OntologyStore interface declared in lib/ontology/ctx.ts:47-56
// against the live drizzle tables in lib/db/schema.generated.ts. This is what
// makes function-backed actions like change-tier.ts:17-37 work end-to-end:
// change-tier calls `ctx.objects.Member.update(...)`, which until now had no
// production-grade implementation (only the in-memory test fixture).
//
// Design notes:
//   - The accessor layer is intentionally thin. Permission filtering happens
//     one level up in `createCtx` (lib/ontology/ctx.ts:299) via the
//     `wrapObjectAccess` decorator — this store carries no auth surface.
//   - Links table (`member_attended_event`) is exposed via LinkAccess<L>.
//     `traverse` filters in SQL when from/to are bound, returns all otherwise.
//   - Codegen exposes one table per object type, so the dispatch is by name
//     (a small dictionary keyed by ontology type name → drizzle table).

import { and, eq } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  event as eventTable,
  meeting_minute as meetingMinuteTable,
  member as memberTable,
  member_attended_event as attendedTable,
  member_context as memberContextTable,
  agent_blocker as agentBlockerTable,
} from "../db/schema.generated";
import type {
  AgentBlocker,
  AttendedLink,
  Event,
  MeetingMinute,
  Member,
  MemberContext,
} from "./types.generated";
import type {
  LinkAccess,
  LinkEdge,
  ObjectAccess,
  ObjectFilter,
  OntologyStore,
} from "./ctx";

// drizzle's table type erases column metadata at this level; we accept the
// minimal structural shape we use (`.id` column for primary-key access) and
// keep the rest as `any` for query builder fluency.
type TableWithId = { id: { name: string } } & Record<string, unknown>;

function buildObjectAccess<T extends { id: string }>(
  db: Database,
  table: TableWithId,
): ObjectAccess<T> {
  return {
    async findById(id: string): Promise<T | null> {
      const rows = (await db
        .select()
        .from(table as never)
        .where(eq((table as never as { id: unknown }).id as never, id))
        .limit(1)) as unknown as T[];
      return rows[0] ?? null;
    },
    async findMany(filter: ObjectFilter<T> = {}): Promise<T[]> {
      const entries = Object.entries(filter) as [string, unknown][];
      if (entries.length === 0) {
        return (await db.select().from(table as never)) as unknown as T[];
      }
      const conds = entries
        .filter(([, v]) => v !== undefined)
        .map(([col, v]) => eq((table as Record<string, unknown>)[col] as never, v));
      const where = conds.length === 1 ? conds[0] : and(...conds);
      return (await db
        .select()
        .from(table as never)
        .where(where as never)) as unknown as T[];
    },
    async create(input: T): Promise<T> {
      const [row] = (await db
        .insert(table as never)
        .values(input as never)
        .returning()) as unknown as T[];
      return row;
    },
    async update(id: string, patch: Partial<T>): Promise<T | null> {
      // Strip `id` from patch — primary key is the targeting clause, not a
      // payload column. Mirrors the in-memory store's behavior.
      const { id: _ignore, ...rest } = patch as Partial<T> & { id?: string };
      void _ignore;
      const [row] = (await db
        .update(table as never)
        .set(rest as never)
        .where(eq((table as never as { id: unknown }).id as never, id))
        .returning()) as unknown as T[];
      return row ?? null;
    },
    async delete(id: string): Promise<boolean> {
      const rows = (await db
        .delete(table as never)
        .where(eq((table as never as { id: unknown }).id as never, id))
        .returning()) as unknown as T[];
      return rows.length > 0;
    },
  };
}

function buildAttendedLinkAccess(db: Database): LinkAccess<AttendedLink> {
  return {
    async create(input) {
      await db
        .insert(attendedTable)
        .values({
          member_id: input.from,
          event_id: input.to,
          attended_at: new Date(input.properties.attended_at),
          role: input.properties.role,
        })
        .onConflictDoUpdate({
          target: [attendedTable.member_id, attendedTable.event_id],
          set: {
            attended_at: new Date(input.properties.attended_at),
            role: input.properties.role,
          },
        });
    },
    async delete(input) {
      const rows = await db
        .delete(attendedTable)
        .where(
          and(
            eq(attendedTable.member_id, input.from),
            eq(attendedTable.event_id, input.to),
          ),
        )
        .returning();
      return rows.length > 0;
    },
    async traverse(input) {
      const conds = [];
      if (input.from !== undefined) conds.push(eq(attendedTable.member_id, input.from));
      if (input.to !== undefined) conds.push(eq(attendedTable.event_id, input.to));
      const rows =
        conds.length === 0
          ? await db.select().from(attendedTable)
          : await db
              .select()
              .from(attendedTable)
              .where(conds.length === 1 ? conds[0] : and(...conds));
      return rows.map((r): LinkEdge<AttendedLink> => ({
        from: r.member_id,
        to: r.event_id,
        properties: {
          attended_at:
            r.attended_at instanceof Date
              ? r.attended_at.toISOString()
              : String(r.attended_at),
          role: r.role as AttendedLink["role"],
        },
      }));
    },
  };
}

export function createPgOntologyStore(db: Database): OntologyStore {
  return {
    objects: {
      Member: buildObjectAccess<Member>(db, memberTable as unknown as TableWithId),
      Event: buildObjectAccess<Event>(db, eventTable as unknown as TableWithId),
      MeetingMinute: buildObjectAccess<MeetingMinute>(
        db,
        meetingMinuteTable as unknown as TableWithId,
      ),
      // M4.3: member context + agent escalation blockers
      MemberContext: buildObjectAccess<MemberContext>(
        db,
        memberContextTable as unknown as TableWithId,
      ),
      AgentBlocker: buildObjectAccess<AgentBlocker>(
        db,
        agentBlockerTable as unknown as TableWithId,
      ),
    },
    links: {
      attended: buildAttendedLinkAccess(db),
    },
  };
}
