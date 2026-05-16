// US-030: action_audit middleware.
//
// Every action invocation is wrapped by an audit_pre / body / audit_post
// envelope. audit_pre records a pending row, computes a stable idempotency
// key from (actor, action_type, canonical params), and detects replays:
// a prior completed row with the same key short-circuits the body and
// returns its result. audit_post records completion (ok or error) with
// duration, parent linkage, and the captured result.

import { beforeEach, describe, expect, it } from "vitest";
import type { Actor } from "../ctx";
import {
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "../ontology/ctx";
import { InMemoryAuditStore } from "../audit/writer";
import {
  auditPostInvocation,
  auditPreInvocation,
  computeIdempotencyKey,
} from "./audit-middleware";

const steward: Actor = {
  userId: "u-steward",
  email: "s@example.com",
  role: "steward",
  customRoles: [],
};

const member: Actor = {
  userId: "u-member",
  email: "m@example.com",
  role: "member",
  customRoles: [],
};

let db: OntologyStore;
let audit: InMemoryAuditStore;
let ctx: OntologyCtx;
let ctxNoAudit: OntologyCtx;

beforeEach(() => {
  db = createInMemoryStore();
  audit = new InMemoryAuditStore();
  ctx = createCtx({ db, actor: steward, audit });
  ctxNoAudit = createCtx({ db, actor: steward });
});

describe("computeIdempotencyKey", () => {
  it("returns the same key for identical actor + action + params", () => {
    const a = computeIdempotencyKey({
      actor: steward,
      actionName: "add_member",
      params: { full_name: "Ada", email: "ada@x.com" },
    });
    const b = computeIdempotencyKey({
      actor: steward,
      actionName: "add_member",
      params: { full_name: "Ada", email: "ada@x.com" },
    });
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("is param-order independent (canonical form)", () => {
    const a = computeIdempotencyKey({
      actor: steward,
      actionName: "add_member",
      params: { full_name: "Ada", email: "ada@x.com" },
    });
    const b = computeIdempotencyKey({
      actor: steward,
      actionName: "add_member",
      params: { email: "ada@x.com", full_name: "Ada" },
    });
    expect(a).toBe(b);
  });

  it("differs when actor differs", () => {
    const a = computeIdempotencyKey({
      actor: steward,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    const b = computeIdempotencyKey({
      actor: member,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    expect(a).not.toBe(b);
  });

  it("differs when params differ", () => {
    const a = computeIdempotencyKey({
      actor: steward,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    const b = computeIdempotencyKey({
      actor: steward,
      actionName: "add_member",
      params: { full_name: "Grace" },
    });
    expect(a).not.toBe(b);
  });

  it("differs when action name differs", () => {
    const a = computeIdempotencyKey({
      actor: steward,
      actionName: "add_member",
      params: {},
    });
    const b = computeIdempotencyKey({
      actor: steward,
      actionName: "record_attendance",
      params: {},
    });
    expect(a).not.toBe(b);
  });

  it("handles a null actor (anonymous invocation)", () => {
    const a = computeIdempotencyKey({
      actor: null,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    const b = computeIdempotencyKey({
      actor: null,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    expect(a).toBe(b);
  });
});

describe("auditPreInvocation — new invocation", () => {
  it("records a pending row in action_audit with actor, role, action, params, idempotency_key", async () => {
    const params = { full_name: "Ada", email: "ada@x.com" };
    const pre = await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params,
    });

    expect(pre.kind).toBe("new");
    if (pre.kind !== "new") return;
    expect(pre.pendingAuditId).toEqual(expect.any(String));
    expect(pre.idempotencyKey).toEqual(expect.any(String));

    const rows = await audit.listActionAudit();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.actor).toBe("u-steward");
    expect(row.actor_role).toBe("steward");
    expect(row.via).toBe("inngest");
    expect(row.subject_type).toBe("action");
    expect(row.subject_id).toBe("add_member");
    expect(row.before).toBeNull();
    expect(row.after).toBeNull();
    expect(row.metadata).toMatchObject({
      result: "pending",
      idempotency_key: pre.idempotencyKey,
      params,
    });
  });

  it("captures parent_action_audit_id in metadata when provided", async () => {
    const pre = await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
      parentAuditId: "parent-row-id",
    });
    expect(pre.kind).toBe("new");

    const rows = await audit.listActionAudit();
    expect(rows[0].metadata.parent_action_audit_id).toBe("parent-row-id");
  });

  it("records actor as <anonymous> when actor is null", async () => {
    const anonCtx = createCtx({ db, actor: null, audit });
    await auditPreInvocation({
      ctx: anonCtx,
      actionName: "add_member",
      params: {},
    });
    const rows = await audit.listActionAudit();
    expect(rows[0].actor).toBe("<anonymous>");
    expect(rows[0].actor_role).toBe("<anonymous>");
  });

  it("no-ops gracefully when ctx.audit is absent (still returns idempotency key)", async () => {
    const pre = await auditPreInvocation({
      ctx: ctxNoAudit,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    expect(pre.kind).toBe("new");
    if (pre.kind !== "new") return;
    expect(pre.pendingAuditId).toBeNull();
    expect(pre.idempotencyKey).toEqual(expect.any(String));
  });
});

describe("auditPreInvocation — replay detection", () => {
  it("returns kind=replay with prior result when a completed row exists for the same key", async () => {
    // First invocation: simulate pre+post completing successfully.
    const first = await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    expect(first.kind).toBe("new");
    if (first.kind !== "new") return;
    await auditPostInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
      pendingAuditId: first.pendingAuditId,
      idempotencyKey: first.idempotencyKey,
      status: "ok",
      durationMs: 5,
      result: { ok: true, directive: "creates_object", object_type: "Member", id: "m-1" },
    });

    // Second invocation with identical (actor, action, params) → replay.
    const second = await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    expect(second.kind).toBe("replay");
    if (second.kind !== "replay") return;
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.priorResult).toEqual({
      ok: true,
      directive: "creates_object",
      object_type: "Member",
      id: "m-1",
    });
  });

  it("records the replay attempt as its own audit row (replays are recorded)", async () => {
    const first = await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    if (first.kind !== "new") throw new Error("expected new");
    await auditPostInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
      pendingAuditId: first.pendingAuditId,
      idempotencyKey: first.idempotencyKey,
      status: "ok",
      durationMs: 5,
      result: { id: "m-1" },
    });

    const beforeReplay = (await audit.listActionAudit()).length;
    await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    const afterReplay = await audit.listActionAudit();
    expect(afterReplay.length).toBe(beforeReplay + 1);
    expect(afterReplay[afterReplay.length - 1].metadata).toMatchObject({
      result: "replay",
      idempotency_key: first.idempotencyKey,
    });
  });

  it("does NOT treat a pending row (incomplete prior) as replayable", async () => {
    // No audit_post follow-up → pending row stays. A new pre should NOT
    // short-circuit; replays only kick in once a prior call completed ok.
    await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    const second = await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    expect(second.kind).toBe("new");
  });

  it("does NOT treat an errored prior invocation as replayable", async () => {
    const first = await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    if (first.kind !== "new") throw new Error("expected new");
    await auditPostInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
      pendingAuditId: first.pendingAuditId,
      idempotencyKey: first.idempotencyKey,
      status: "error",
      durationMs: 5,
      error: new Error("boom"),
    });

    const second = await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    expect(second.kind).toBe("new");
  });
});

describe("auditPostInvocation — success", () => {
  it("records a completion row with status=ok, duration_ms, and result captured", async () => {
    const pre = await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    if (pre.kind !== "new") throw new Error("expected new");

    const result = {
      ok: true,
      directive: "creates_object",
      object_type: "Member",
      id: "m-1",
    };
    await auditPostInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
      pendingAuditId: pre.pendingAuditId,
      idempotencyKey: pre.idempotencyKey,
      status: "ok",
      durationMs: 42,
      result,
    });

    const rows = await audit.listActionAudit();
    expect(rows).toHaveLength(2);
    const post = rows[1];
    expect(post.subject_type).toBe("action");
    expect(post.subject_id).toBe("add_member");
    expect(post.after).toEqual(result);
    expect(post.metadata).toMatchObject({
      result: "ok",
      idempotency_key: pre.idempotencyKey,
      pending_audit_id: pre.pendingAuditId,
      duration_ms: 42,
      params: { full_name: "Ada" },
    });
  });

  it("includes parent_action_audit_id in the post row when provided", async () => {
    const pre = await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
      parentAuditId: "parent-row-id",
    });
    if (pre.kind !== "new") throw new Error("expected new");
    await auditPostInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
      pendingAuditId: pre.pendingAuditId,
      idempotencyKey: pre.idempotencyKey,
      parentAuditId: "parent-row-id",
      status: "ok",
      durationMs: 5,
      result: { ok: true },
    });

    const rows = await audit.listActionAudit();
    const post = rows[1];
    expect(post.metadata.parent_action_audit_id).toBe("parent-row-id");
  });
});

describe("auditPostInvocation — error", () => {
  it("records a completion row with status=error, error_message, and duration_ms", async () => {
    const pre = await auditPreInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
    });
    if (pre.kind !== "new") throw new Error("expected new");

    await auditPostInvocation({
      ctx,
      actionName: "add_member",
      params: { full_name: "Ada" },
      pendingAuditId: pre.pendingAuditId,
      idempotencyKey: pre.idempotencyKey,
      status: "error",
      durationMs: 12,
      error: new Error("could not insert: duplicate email"),
    });

    const rows = await audit.listActionAudit();
    const post = rows[1];
    expect(post.after).toBeNull();
    expect(post.metadata).toMatchObject({
      result: "error",
      idempotency_key: pre.idempotencyKey,
      duration_ms: 12,
      error_message: "could not insert: duplicate email",
    });
  });
});

describe("auditPostInvocation — no-op without store", () => {
  it("does not throw when ctx.audit is absent", async () => {
    await expect(
      auditPostInvocation({
        ctx: ctxNoAudit,
        actionName: "add_member",
        params: {},
        pendingAuditId: null,
        idempotencyKey: "k",
        status: "ok",
        durationMs: 1,
        result: { ok: true },
      }),
    ).resolves.toBeUndefined();
  });
});
