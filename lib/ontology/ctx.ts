// Typed ontology accessor — single facade over ontology storage that app code,
// function-backed actions, and the agent share.
//
// US-007 introduced the surface; US-031 (this file's current state) wraps it
// with permission filtering: object-level read/write, property-level read,
// and the `member_self` token resolved against a row's owner identity.
// Action handlers are still stubs; US-027 will implement them.

import type { AuditStore } from "../audit/writer";
import type { Actor } from "../ctx";
import type { NotificationStore } from "../notifications/store";
import type { Ontology, PermissionsBlock } from "./schema";
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

// === Access surface ===

export type ObjectFilter<T> = Partial<T>;

export interface ObjectAccess<T extends { id: string }> {
  findById(id: string): Promise<T | null>;
  findMany(filter?: ObjectFilter<T>): Promise<T[]>;
  create(input: T): Promise<T>;
  update(id: string, patch: Partial<T>): Promise<T | null>;
  delete(id: string): Promise<boolean>;
}

export interface LinkEdge<L> {
  from: string;
  to: string;
  properties: L;
}

export interface LinkAccess<L> {
  create(input: { from: string; to: string; properties: L }): Promise<void>;
  delete(input: { from: string; to: string }): Promise<boolean>;
  traverse(input: { from?: string; to?: string }): Promise<LinkEdge<L>[]>;
}

export interface OntologyStore {
  objects: {
    // Core member/community types (original 4 — semantics and permission wiring
    // are unchanged; these are listed first for call-site stability).
    Member: ObjectAccess<Member>;
    Event: ObjectAccess<Event>;
    MemberContext: ObjectAccess<MemberContext>;
    AgentBlocker: ObjectAccess<AgentBlocker>;
    // Hostel-domain types — all exposed through the same permission-checked
    // ObjectAccess surface as the 4 above; permissions are derived from the
    // loaded ontology's object_type.permissions.read/write per type.
    Bed: ObjectAccess<Bed>;
    Booking: ObjectAccess<Booking>;
    Guest: ObjectAccess<Guest>;
    IncidentLog: ObjectAccess<IncidentLog>;
    MeetingMinute: ObjectAccess<MeetingMinute>;
    Notification: ObjectAccess<Notification>;
    Room: ObjectAccess<Room>;
    Shift: ObjectAccess<Shift>;
    WorkTradeAgreement: ObjectAccess<WorkTradeAgreement>;
  };
  // 0c-pre2: links typed as open record — attended/authored removed with community schema.
  // Hostel-domain link types will be added here as they are defined.
  links: Record<string, LinkAccess<Record<string, unknown>>>;
}

// === Action stubs (US-027 will implement) ===

export interface ActionStubResult {
  ok: false;
  reason: "not_implemented";
  action: string;
}

export interface OntologyActions {
  // 0c-pre2: add_member/add_meeting_minute/change_tier/record_attendance removed;
  // those param types no longer exist in types.generated (schema migrated to hostel domain).
  // Follow-up: wire hostel-domain action stubs here.
}

// === Permission model ===

export interface ObjectPermissions {
  read?: string[];
  write?: string[];
  properties?: Record<string, PermissionsBlock>;
}

export type ObjectPermissionsMap = Record<string, ObjectPermissions>;

export type PermissionOperation =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "invoke";

export class PermissionError extends Error {
  constructor(
    message: string,
    readonly actorId: string | null,
    readonly objectType: string,
    readonly operation: PermissionOperation,
  ) {
    super(message);
    this.name = "PermissionError";
  }
}

// `member_self` matches when the row's owner identity equals actor.userId.
// We probe the common conventions (user_id, owner_id, owner) and fall back
// to `row.id` for self-referencing types like Member, where the row IS the
// user record.
function rowOwnedBy(
  actor: Actor,
  row: Record<string, unknown>,
  objectTypeName: string,
): boolean {
  if (row.user_id === actor.userId) return true;
  if (row.owner_id === actor.userId) return true;
  if (row.owner === actor.userId) return true;
  if (row.userId === actor.userId) return true;
  // M4.1: Notification rows are owned by their recipient_member_id. The
  // locked perm spec ("member_self via recipient_member_id") makes this
  // the natural ownership probe. Generic on field name so any future
  // object type using the same convention works without code change.
  if (row.recipient_member_id === actor.userId) return true;
  // M4.3: AgentBlocker rows are owned by blocked_actor_id.
  if (row.blocked_actor_id === actor.userId) return true;
  // M4.3: MemberContext rows are owned by member_id.
  // Scoped to these two types only to avoid false-positive ownership on
  // unrelated types that happen to have a member_id field (e.g. MeetingMinute.member_id = author).
  if (
    (objectTypeName === "MemberContext" || objectTypeName === "AgentBlocker") &&
    row.member_id === actor.userId
  ) return true;
  if (objectTypeName === "Member" && row.id === actor.userId) return true;
  return false;
}

// Exported so the widget read path (lib/widgets/read-api.ts) gates by the
// SAME permission semantics as ctx.objects — one permission model, not two.
// Type-level gates (no per-row context) pass `row = null`: `member_self`
// cannot match without a row, which is correct (the catalog gate is a coarse
// type-level read fence; per-row ownership is enforced by ctx.objects).
export function actorMatchesTokens(
  actor: Actor | null,
  tokens: string[] | undefined,
  row: Record<string, unknown> | null,
  objectTypeName: string,
): boolean {
  // No tokens declared, or empty array => DENY (no one matches).
  // An empty/missing list is not "public" — it means "no one is permitted".
  // The only allow-all shorthand is the explicit ["*"] wildcard.
  if (!tokens || tokens.length === 0) return false;
  if (tokens.includes("*")) return true;
  if (!actor) return false;
  for (const token of tokens) {
    if (token === actor.role) return true;
    if (actor.customRoles.includes(token)) return true;
    if (token === "member_self" && row && rowOwnedBy(actor, row, objectTypeName)) {
      return true;
    }
  }
  return false;
}

function filterReadableProperties<T extends { id: string }>(
  row: T,
  perms: ObjectPermissions | undefined,
  actor: Actor | null,
  objectTypeName: string,
): T {
  if (!perms?.properties) return row;
  const rowRecord = row as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...rowRecord };
  for (const [propName, propPerm] of Object.entries(perms.properties)) {
    if (
      propPerm.read &&
      !actorMatchesTokens(actor, propPerm.read, rowRecord, objectTypeName)
    ) {
      delete out[propName];
    }
  }
  return out as T;
}

function denyWrite(
  actor: Actor | null,
  objectType: string,
  operation: PermissionOperation,
): never {
  throw new PermissionError(
    `actor ${actor?.userId ?? "<anonymous>"} cannot ${operation} ${objectType}`,
    actor?.userId ?? null,
    objectType,
    operation,
  );
}

function wrapObjectAccess<T extends { id: string }>(
  base: ObjectAccess<T>,
  perms: ObjectPermissions | undefined,
  actor: Actor | null,
  objectTypeName: string,
): ObjectAccess<T> {
  // FAIL CLOSED: when no permissions entry exists for a type, return a
  // deny-all wrapper. This prevents world-readable/writable access on any
  // type that is exposed via ctx.objects but not yet defined in the loaded
  // ontology's permissions map. Mirrors the null/[]/throw semantics of the
  // wrapper below: reads return null/[], writes throw PermissionError.
  if (!perms) {
    return {
      async findById(_id) { return null; },
      async findMany(_filter) { return []; },
      async create(_input) { denyWrite(actor, objectTypeName, "create"); },
      async update(_id, _patch) { denyWrite(actor, objectTypeName, "update"); },
      async delete(_id) { denyWrite(actor, objectTypeName, "delete"); },
    };
  }
  return {
    async findById(id) {
      const row = await base.findById(id);
      if (!row) return null;
      if (
        !actorMatchesTokens(
          actor,
          perms.read,
          row as unknown as Record<string, unknown>,
          objectTypeName,
        )
      ) {
        return null;
      }
      return filterReadableProperties(row, perms, actor, objectTypeName);
    },
    async findMany(filter) {
      const all = await base.findMany(filter);
      return all
        .filter((row) =>
          actorMatchesTokens(
            actor,
            perms.read,
            row as unknown as Record<string, unknown>,
            objectTypeName,
          ),
        )
        .map((row) => filterReadableProperties(row, perms, actor, objectTypeName));
    },
    async create(input) {
      if (
        !actorMatchesTokens(
          actor,
          perms.write,
          input as unknown as Record<string, unknown>,
          objectTypeName,
        )
      ) {
        denyWrite(actor, objectTypeName, "create");
      }
      return base.create(input);
    },
    async update(id, patch) {
      const existing = await base.findById(id);
      if (!existing) return null;
      if (
        !actorMatchesTokens(
          actor,
          perms.write,
          existing as unknown as Record<string, unknown>,
          objectTypeName,
        )
      ) {
        denyWrite(actor, objectTypeName, "update");
      }
      return base.update(id, patch);
    },
    async delete(id) {
      const existing = await base.findById(id);
      if (!existing) return false;
      if (
        !actorMatchesTokens(
          actor,
          perms.write,
          existing as unknown as Record<string, unknown>,
          objectTypeName,
        )
      ) {
        denyWrite(actor, objectTypeName, "delete");
      }
      return base.delete(id);
    },
  };
}

// Derive an ObjectPermissionsMap from a loaded ontology. Inline property
// permissions are surfaced; ref-style properties (which point to the shared
// registry) carry no inline permissions in the current schema.
export function buildObjectPermissionsMap(
  ontology: Ontology,
): ObjectPermissionsMap {
  const map: ObjectPermissionsMap = {};
  for (const [name, def] of Object.entries(ontology.object_types)) {
    const propPerms: Record<string, PermissionsBlock> = {};
    for (const [propName, propDef] of Object.entries(def.properties)) {
      if ("permissions" in propDef && propDef.permissions) {
        propPerms[propName] = propDef.permissions;
      }
    }
    map[name] = {
      read: def.permissions?.read,
      write: def.permissions?.write,
      ...(Object.keys(propPerms).length > 0 ? { properties: propPerms } : {}),
    };
  }
  return map;
}

// === createCtx ===

export interface CreateCtxInput {
  db: OntologyStore;
  actor: Actor | null;
  permissions?: ObjectPermissionsMap;
  // Optional audit sink. When provided, action middleware (US-032) writes
  // rejection rows here; action_audit middleware (US-030) will write success
  // rows here as well.
  audit?: AuditStore;
  // M4.1: optional notification sink. When provided, the notify_member
  // side-effect dispatcher writes an inbox row for the actor in addition
  // to firing the stdout/email adapter. Tests inject InMemoryNotificationStore;
  // the runtime ctx builder wires PgNotificationStore.
  notifications?: NotificationStore;
}

export interface OntologyCtx {
  actor: Actor | null;
  objects: OntologyStore["objects"];
  links: OntologyStore["links"];
  actions: OntologyActions;
  audit?: AuditStore;
  notifications?: NotificationStore;
}

// M4.3: rowOwnedBy extension — AgentBlocker uses blocked_actor_id
// (already handled by the existing member_self token logic: the function
// checks the conventional field names including blocked_actor_id below).
// We extend rowOwnedBy to support the new field name.

export function createCtx({
  db,
  actor,
  permissions,
  audit,
  notifications,
}: CreateCtxInput): OntologyCtx {
  const wrap = <T extends { id: string }>(
    access: ObjectAccess<T>,
    typeName: string,
  ): ObjectAccess<T> => {
    if (!permissions) return access;
    // Defense-in-depth: warn when an exposed type has no permissions entry.
    // wrapObjectAccess already fails closed (deny-all) for this case, so it
    // is safe — but a missing entry almost certainly means a misconfigured
    // ontology, and silent denial is hard to debug. The warn makes it visible.
    if (permissions[typeName] === undefined) {
      console.warn(
        `[acropolisOS] createCtx: no permissions entry for type "${typeName}" — ` +
        `access will be denied for all actors. Check the loaded ontology's object_types.`,
      );
    }
    return wrapObjectAccess(access, permissions[typeName], actor, typeName);
  };

  return {
    actor,
    objects: {
      // Original 4 — permission wiring unchanged.
      Member: wrap(db.objects.Member, "Member"),
      Event: wrap(db.objects.Event, "Event"),
      MemberContext: wrap(db.objects.MemberContext, "MemberContext"),
      AgentBlocker: wrap(db.objects.AgentBlocker, "AgentBlocker"),
      // Hostel-domain types — same wrapObjectAccess decorator, permissions from
      // the loaded ontology map passed as `permissions` to createCtx.
      Bed: wrap(db.objects.Bed, "Bed"),
      Booking: wrap(db.objects.Booking, "Booking"),
      Guest: wrap(db.objects.Guest, "Guest"),
      IncidentLog: wrap(db.objects.IncidentLog, "IncidentLog"),
      MeetingMinute: wrap(db.objects.MeetingMinute, "MeetingMinute"),
      Notification: wrap(db.objects.Notification, "Notification"),
      Room: wrap(db.objects.Room, "Room"),
      Shift: wrap(db.objects.Shift, "Shift"),
      WorkTradeAgreement: wrap(db.objects.WorkTradeAgreement, "WorkTradeAgreement"),
    },
    links: db.links,
    actions: {},
    ...(audit ? { audit } : {}),
    ...(notifications ? { notifications } : {}),
  };
}

// === In-memory store (tests + setup wizard seed in US-010) ===

class InMemoryObjectAccess<T extends { id: string }>
  implements ObjectAccess<T>
{
  private readonly rows = new Map<string, T>();

  async findById(id: string): Promise<T | null> {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : null;
  }

  async findMany(filter: ObjectFilter<T> = {}): Promise<T[]> {
    const entries = Object.entries(filter) as [keyof T, unknown][];
    return [...this.rows.values()]
      .filter((row) =>
        entries.every(
          ([key, value]) => (row as Record<string, unknown>)[key as string] === value,
        ),
      )
      .map((row) => structuredClone(row));
  }

  async create(input: T): Promise<T> {
    if (this.rows.has(input.id)) {
      throw new Error(`${this.constructor.name}: row already exists: ${input.id}`);
    }
    const row = structuredClone(input);
    this.rows.set(row.id, row);
    return structuredClone(row);
  }

  async update(id: string, patch: Partial<T>): Promise<T | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...structuredClone(patch), id } as T;
    this.rows.set(id, updated);
    return structuredClone(updated);
  }

  async delete(id: string): Promise<boolean> {
    return this.rows.delete(id);
  }
}

class InMemoryLinkAccess<L> implements LinkAccess<L> {
  private readonly edges: LinkEdge<L>[] = [];

  async create(input: {
    from: string;
    to: string;
    properties: L;
  }): Promise<void> {
    const existingIdx = this.edges.findIndex(
      (e) => e.from === input.from && e.to === input.to,
    );
    const edge: LinkEdge<L> = {
      from: input.from,
      to: input.to,
      properties: structuredClone(input.properties),
    };
    if (existingIdx >= 0) {
      this.edges[existingIdx] = edge;
    } else {
      this.edges.push(edge);
    }
  }

  async delete(input: { from: string; to: string }): Promise<boolean> {
    const idx = this.edges.findIndex(
      (e) => e.from === input.from && e.to === input.to,
    );
    if (idx < 0) return false;
    this.edges.splice(idx, 1);
    return true;
  }

  async traverse(input: {
    from?: string;
    to?: string;
  }): Promise<LinkEdge<L>[]> {
    return this.edges
      .filter((e) => (input.from === undefined ? true : e.from === input.from))
      .filter((e) => (input.to === undefined ? true : e.to === input.to))
      .map((e) => structuredClone(e));
  }
}

export function createInMemoryStore(): OntologyStore {
  return {
    objects: {
      // Original 4 — unchanged.
      Member: new InMemoryObjectAccess<Member>(),
      Event: new InMemoryObjectAccess<Event>(),
      MemberContext: new InMemoryObjectAccess<MemberContext>(),
      AgentBlocker: new InMemoryObjectAccess<AgentBlocker>(),
      // Hostel-domain types — same InMemoryObjectAccess, no special logic.
      Bed: new InMemoryObjectAccess<Bed>(),
      Booking: new InMemoryObjectAccess<Booking>(),
      Guest: new InMemoryObjectAccess<Guest>(),
      IncidentLog: new InMemoryObjectAccess<IncidentLog>(),
      MeetingMinute: new InMemoryObjectAccess<MeetingMinute>(),
      Notification: new InMemoryObjectAccess<Notification>(),
      Room: new InMemoryObjectAccess<Room>(),
      Shift: new InMemoryObjectAccess<Shift>(),
      WorkTradeAgreement: new InMemoryObjectAccess<WorkTradeAgreement>(),
    },
    links: {},
  };
}
