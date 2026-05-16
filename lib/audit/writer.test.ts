import { describe, expect, it } from "vitest";
import {
  InMemoryAuditStore,
  recordActionInvocation,
  recordOntologyChange,
} from "./writer";

describe("recordOntologyChange", () => {
  it("inserts a row and returns it with id + at populated", async () => {
    const store = new InMemoryAuditStore();
    const row = await recordOntologyChange(store, {
      actor: "user-1",
      actor_role: "steward",
      via: "proposal",
      subject_type: "object_type",
      subject_id: "Thread",
      before: null,
      after: { description: "A discussion thread" },
    });

    expect(row.id).toEqual(expect.any(String));
    expect(row.at).toBeInstanceOf(Date);
    expect(row.actor).toBe("user-1");
    expect(row.actor_role).toBe("steward");
    expect(row.via).toBe("proposal");
    expect(row.subject_type).toBe("object_type");
    expect(row.subject_id).toBe("Thread");
    expect(row.before).toBeNull();
    expect(row.after).toEqual({ description: "A discussion thread" });
    expect(row.metadata).toEqual({});
  });

  it("reads back the row through listOntologyAudit", async () => {
    const store = new InMemoryAuditStore();
    await recordOntologyChange(store, {
      actor: "user-1",
      actor_role: "steward",
      via: "proposal",
      subject_type: "object_type",
      subject_id: "Thread",
      before: null,
      after: { description: "A discussion thread" },
    });

    const rows = await store.listOntologyAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0].subject_id).toBe("Thread");
  });

  it("roundtrips nested JSONB metadata without mutating the input", async () => {
    const store = new InMemoryAuditStore();
    const metadata = {
      proposal_id: "p-7",
      diff: { added: ["Thread", "Member"], removed: [] },
      counts: { added: 2, removed: 0 },
    };
    const row = await recordOntologyChange(store, {
      actor: "user-1",
      actor_role: "steward",
      via: "proposal",
      subject_type: "object_type",
      subject_id: "Thread",
      before: { description: "old" },
      after: { description: "new" },
      metadata,
    });
    expect(row.metadata).toEqual(metadata);
    expect(row.before).toEqual({ description: "old" });
    expect(row.after).toEqual({ description: "new" });

    metadata.proposal_id = "mutated";
    const [stored] = await store.listOntologyAudit();
    expect(stored.metadata.proposal_id).toBe("p-7");
  });

  it("assigns a unique id per insert", async () => {
    const store = new InMemoryAuditStore();
    const a = await recordOntologyChange(store, {
      actor: "u",
      actor_role: "member",
      via: "proposal",
      subject_type: "object_type",
      subject_id: "A",
      before: null,
      after: {},
    });
    const b = await recordOntologyChange(store, {
      actor: "u",
      actor_role: "member",
      via: "proposal",
      subject_type: "object_type",
      subject_id: "B",
      before: null,
      after: {},
    });
    expect(a.id).not.toBe(b.id);
  });
});

describe("recordActionInvocation", () => {
  it("inserts a row and returns it with id + at populated", async () => {
    const store = new InMemoryAuditStore();
    const row = await recordActionInvocation(store, {
      actor: "user-2",
      actor_role: "member",
      via: "inngest",
      subject_type: "action",
      subject_id: "add-member",
      before: null,
      after: { member_id: "m-9" },
      metadata: { run_id: "run-42" },
    });

    expect(row.id).toEqual(expect.any(String));
    expect(row.at).toBeInstanceOf(Date);
    expect(row.via).toBe("inngest");
    expect(row.subject_id).toBe("add-member");
    expect(row.metadata).toEqual({ run_id: "run-42" });
  });

  it("reads back the row through listActionAudit", async () => {
    const store = new InMemoryAuditStore();
    await recordActionInvocation(store, {
      actor: "user-2",
      actor_role: "member",
      via: "inngest",
      subject_type: "action",
      subject_id: "add-member",
      before: null,
      after: { member_id: "m-9" },
    });

    const rows = await store.listActionAudit();
    expect(rows).toHaveLength(1);
    expect(rows[0].subject_id).toBe("add-member");
    expect(rows[0].metadata).toEqual({});
  });

  it("keeps ontology and action streams independent", async () => {
    const store = new InMemoryAuditStore();
    await recordOntologyChange(store, {
      actor: "u",
      actor_role: "steward",
      via: "proposal",
      subject_type: "object_type",
      subject_id: "Thread",
      before: null,
      after: {},
    });
    await recordActionInvocation(store, {
      actor: "u",
      actor_role: "member",
      via: "inngest",
      subject_type: "action",
      subject_id: "add-member",
      before: null,
      after: {},
    });
    expect(await store.listOntologyAudit()).toHaveLength(1);
    expect(await store.listActionAudit()).toHaveLength(1);
  });
});

describe("InMemoryAuditStore", () => {
  it("exposes no update or delete surface", () => {
    const store = new InMemoryAuditStore();
    const methods = new Set(
      Object.getOwnPropertyNames(Object.getPrototypeOf(store)),
    );
    expect(methods.has("updateOntologyAudit")).toBe(false);
    expect(methods.has("deleteOntologyAudit")).toBe(false);
    expect(methods.has("updateActionAudit")).toBe(false);
    expect(methods.has("deleteActionAudit")).toBe(false);
  });

  it("returns a defensive copy from list*Audit so callers cannot mutate state", async () => {
    const store = new InMemoryAuditStore();
    await recordOntologyChange(store, {
      actor: "u",
      actor_role: "steward",
      via: "proposal",
      subject_type: "object_type",
      subject_id: "Thread",
      before: null,
      after: {},
    });
    const rows = await store.listOntologyAudit();
    rows.length = 0;
    const fresh = await store.listOntologyAudit();
    expect(fresh).toHaveLength(1);
  });
});
