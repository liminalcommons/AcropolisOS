// M2.2 step-2: Postgres-backed OntologyStore.
//
// Implements the OntologyStore interface declared in lib/ontology/ctx.ts against
// the live drizzle tables in lib/db/schema.generated.ts. This is what makes
// function-backed actions like change-tier.ts work end-to-end.
//
// Design notes:
//   - The accessor layer is intentionally thin. Permission filtering happens
//     one level up in `createCtx` (lib/ontology/ctx.ts) via the
//     `wrapObjectAccess` decorator — this store carries no auth surface.
//   - All 13 ontology object types are wired via the same generic
//     `buildObjectAccess` factory — no type-specific logic at this layer.
//     The permission rules for each type come from the ontology YAML and are
//     applied uniformly by wrapObjectAccess in createCtx.
//   - Links table (`member_attended_event`) is exposed via LinkAccess<L>.

import { and, eq, getTableColumns } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  agent_blocker as agentBlockerTable,
  bed as bedTable,
  booking as bookingTable,
  event as eventTable,
  guest as guestTable,
  incident_log as incidentLogTable,
  meeting_minute as meetingMinuteTable,
  member as memberTable,
  member_context as memberContextTable,
  notification as notificationTable,
  room as roomTable,
  shift as shiftTable,
  work_trade_agreement as workTradeAgreementTable,
} from "../db/schema.generated";
import type {
  AgentBlocker,
  Bed,
  Booking,
  Event,
  Guest,
  IncidentLog,
  MeetingMinute,
  Member,
  MemberContext,
  Notification,
  Room,
  Shift,
  WorkTradeAgreement,
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

// TIMESTAMP COERCION (single write boundary). The codegen types timestamp
// properties as ISO strings (types.generated.ts → z.iso.datetime), but emits
// drizzle timestamp columns in the default `date` mode, which expects Date
// objects on write (drizzle calls value.toISOString() — an ISO STRING throws
// "value.toISOString is not a function"). Handlers correctly pass strings
// (matching the TS type), so we convert string → Date for date-typed columns
// here, once, so EVERY function-backed handler that writes a timestamp works
// against the PG store. (Until the codegen emits these columns as mode:'string'
// — blocked on the ontology-source bifurcation — this is the right seam.)
function coerceTimestamps(
  table: TableWithId,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const cols = getTableColumns(table as never) as Record<
    string,
    { dataType?: string } | undefined
  >;
  const out: Record<string, unknown> = { ...values };
  for (const [key, val] of Object.entries(out)) {
    if (typeof val === "string" && cols[key]?.dataType === "date") {
      out[key] = new Date(val);
    }
  }
  return out;
}

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
        .values(coerceTimestamps(table, input as Record<string, unknown>) as never)
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
        .set(coerceTimestamps(table, rest as Record<string, unknown>) as never)
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
      // Original 4 — table bindings and semantics unchanged.
      Member: buildObjectAccess<Member>(db, memberTable as unknown as TableWithId),
      Event: buildObjectAccess<Event>(db, eventTable as unknown as TableWithId),
      MemberContext: buildObjectAccess<MemberContext>(
        db,
        memberContextTable as unknown as TableWithId,
      ),
      AgentBlocker: buildObjectAccess<AgentBlocker>(
        db,
        agentBlockerTable as unknown as TableWithId,
      ),
      // Hostel-domain types — same buildObjectAccess factory, one drizzle table
      // each. Permission enforcement is entirely handled upstream by
      // wrapObjectAccess in createCtx; this layer is auth-free.
      Bed: buildObjectAccess<Bed>(db, bedTable as unknown as TableWithId),
      Booking: buildObjectAccess<Booking>(db, bookingTable as unknown as TableWithId),
      Guest: buildObjectAccess<Guest>(db, guestTable as unknown as TableWithId),
      IncidentLog: buildObjectAccess<IncidentLog>(
        db,
        incidentLogTable as unknown as TableWithId,
      ),
      MeetingMinute: buildObjectAccess<MeetingMinute>(
        db,
        meetingMinuteTable as unknown as TableWithId,
      ),
      Notification: buildObjectAccess<Notification>(
        db,
        notificationTable as unknown as TableWithId,
      ),
      Room: buildObjectAccess<Room>(db, roomTable as unknown as TableWithId),
      Shift: buildObjectAccess<Shift>(db, shiftTable as unknown as TableWithId),
      WorkTradeAgreement: buildObjectAccess<WorkTradeAgreement>(
        db,
        workTradeAgreementTable as unknown as TableWithId,
      ),
    },
    links: {},
  };
}
