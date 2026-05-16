// Typed ontology accessor — single facade over ontology storage that app code,
// function-backed actions, and the agent share.
//
// Permission filtering is a no-op in M0; the `actor` field is part of the
// signature so US-031 can wrap accessors without API churn.
// Action handlers are stubs; US-027 will implement them.

import type { Actor } from "../ctx";
import type {
  AddMeetingMinuteParams,
  AddMemberParams,
  AttendedLink,
  ChangeTierParams,
  Event,
  MeetingMinute,
  Member,
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

// === createCtx ===

export interface CreateCtxInput {
  db: OntologyStore;
  actor: Actor | null;
}

export interface OntologyCtx {
  actor: Actor | null;
  objects: OntologyStore["objects"];
  links: OntologyStore["links"];
  actions: OntologyActions;
}

export function createCtx({ db, actor }: CreateCtxInput): OntologyCtx {
  // M0: pass-through. US-031 will wrap each accessor with permission filtering
  // keyed off `actor.role` / `actor.customRoles` and per-property permissions
  // from the ontology — no signature change needed.
  void actor;

  const stub =
    <P>(name: string) =>
    async (_params: P): Promise<ActionStubResult> => {
      void _params;
      return { ok: false, reason: "not_implemented", action: name };
    };

  return {
    actor,
    objects: db.objects,
    links: db.links,
    actions: {
      add_member: stub<AddMemberParams>("add_member"),
      add_meeting_minute: stub<AddMeetingMinuteParams>("add_meeting_minute"),
      change_tier: stub<ChangeTierParams>("change_tier"),
      record_attendance: stub<RecordAttendanceParams>("record_attendance"),
    },
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
    },
    links: {
      attended: new InMemoryLinkAccess<AttendedLink>(),
    },
  };
}
