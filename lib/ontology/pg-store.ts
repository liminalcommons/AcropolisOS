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
// 0c-pre2: meeting_minute + member_attended_event removed (absent from schema.generated)
import type { Database } from "../db/client";
import {
  event as eventTable,
  member as memberTable,
  member_context as memberContextTable,
  agent_blocker as agentBlockerTable,
} from "../db/schema.generated";
import type {
  AgentBlocker,
  Event,
  Member,
  MemberContext,
} from "./types.generated";
import type {
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

export function createPgOntologyStore(db: Database): OntologyStore {
  return {
    objects: {
      Member: buildObjectAccess<Member>(db, memberTable as unknown as TableWithId),
      Event: buildObjectAccess<Event>(db, eventTable as unknown as TableWithId),
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
    links: {},
  };
}
