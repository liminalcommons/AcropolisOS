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
  AddMeetingMinuteParams,
  AddMemberParams,
  AgentBlocker,
  AttendedLink,
  ChangeTierParams,
  Event,
  MeetingMinute,
  Member,
  MemberContext,
  RecordAttendanceParams,
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
    Member: ObjectAccess<Member>;
    Event: ObjectAccess<Event>;
    MeetingMinute: ObjectAccess<MeetingMinute>;
    // M4.3: per-member context + agent escalation blockers
    MemberContext: ObjectAccess<MemberContext>;
    AgentBlocker: ObjectAccess<AgentBlocker>;
  };
  links: {
    attended: LinkAccess<AttendedLink>;
  };
}

// === Action stubs (US-027 will implement) ===

export interface ActionStubResult {
  ok: false;
  reason: "not_implemented";
  action: string;
}

export interface OntologyActions {
  add_member(params: AddMemberParams): Promise<ActionStubResult>;
  add_meeting_minute(params: AddMeetingMinuteParams): Promise<ActionStubResult>;
  change_tier(params: ChangeTierParams): Promise<ActionStubResult>;
  record_attendance(
    params: RecordAttendanceParams,
  ): Promise<ActionStubResult>;
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

function actorMatchesTokens(
  actor: Actor | null,
  tokens: string[] | undefined,
  row: Record<string, unknown> | null,
  objectTypeName: string,
): boolean {
  // No tokens declared => unrestricted at this level.
  if (!tokens || tokens.length === 0) return true;
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
  if (!perms) return base;
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
  ): ObjectAccess<T> =>
    permissions ? wrapObjectAccess(access, permissions[typeName], actor, typeName) : access;

  const stub =
    <P>(name: string) =>
    async (_params: P): Promise<ActionStubResult> => {
      void _params;
      return { ok: false, reason: "not_implemented", action: name };
    };

  return {
    actor,
    objects: {
      Member: wrap(db.objects.Member, "Member"),
      Event: wrap(db.objects.Event, "Event"),
      MeetingMinute: wrap(db.objects.MeetingMinute, "MeetingMinute"),
      // M4.3: member context + agent escalation blockers
      MemberContext: wrap(db.objects.MemberContext, "MemberContext"),
      AgentBlocker: wrap(db.objects.AgentBlocker, "AgentBlocker"),
    },
    links: db.links,
    actions: {
      add_member: stub<AddMemberParams>("add_member"),
      add_meeting_minute: stub<AddMeetingMinuteParams>("add_meeting_minute"),
      change_tier: stub<ChangeTierParams>("change_tier"),
      record_attendance: stub<RecordAttendanceParams>("record_attendance"),
    },
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
      Member: new InMemoryObjectAccess<Member>(),
      Event: new InMemoryObjectAccess<Event>(),
      MeetingMinute: new InMemoryObjectAccess<MeetingMinute>(),
      // M4.3: member context + agent escalation blockers
      MemberContext: new InMemoryObjectAccess<MemberContext>(),
      AgentBlocker: new InMemoryObjectAccess<AgentBlocker>(),
    },
    links: {
      attended: new InMemoryLinkAccess<AttendedLink>(),
    },
  };
}
