// US-028: Side effects dispatcher.
//
// After an action invocation completes successfully (audit_post ok), the
// dispatcher fans out to each declared side-effect channel:
//   - audit              → no-op (the middleware already wrote the audit row)
//   - notify_member      → email the actor (their action acknowledgment)
//   - notify_steward     → email all configured stewards
//   - webhook            → POST {action, params, result, auditId} to a URL
//
// Failures in any channel MUST NOT throw — they are captured per-channel
// so the action's audit envelope stays "ok". Inngest retry policy applies
// at the wrapper level once the dispatch is hoisted into the generated
// codegen step.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../ctx";
import {
  createCtx,
  createInMemoryStore,
  type OntologyCtx,
  type OntologyStore,
} from "../ontology/ctx";
import { InMemoryAuditStore } from "../audit/writer";
import type { Ontology } from "../ontology/schema";
import {
  dispatchSideEffects,
  loadSideEffectConfigFromEnv,
  type SideEffectAdapters,
  type SideEffectResult,
} from "./side-effects";

const steward: Actor = {
  userId: "u-steward",
  email: "steward@example.com",
  role: "steward",
  customRoles: [],
};

const memberActor: Actor = {
  userId: "u-member",
  email: "member@example.com",
  role: "member",
  customRoles: [],
};

function makeOntology(overrides?: Partial<Ontology>): Ontology {
  return {
    properties: {},
    roles: { steward: {}, member: {} },
    object_types: {},
    link_types: {},
    action_types: {
      change_tier: {
        description: "Move a member to a different tier",
        function: "change-tier",
        permissions: ["steward"],
        agent_policy: "always_confirm",
        side_effects: ["audit", "notify_member"],
      },
      add_member: {
        description: "Add a new member",
        creates_object: "Member",
        permissions: ["steward"],
        agent_policy: "always_confirm",
        side_effects: ["audit", "notify_steward", "webhook"],
      },
      silent_action: {
        description: "Has no side_effects declared",
        function: "silent",
        permissions: ["steward"],
        agent_policy: "always_confirm",
      },
    },
    ...overrides,
  };
}

let db: OntologyStore;
let ctxSteward: OntologyCtx;
let ctxMember: OntologyCtx;
let sendMail: ReturnType<typeof vi.fn>;
let postWebhook: ReturnType<typeof vi.fn>;
let adapters: SideEffectAdapters;

beforeEach(() => {
  db = createInMemoryStore();
  ctxSteward = createCtx({ db, actor: steward });
  ctxMember = createCtx({ db, actor: memberActor });
  sendMail = vi.fn(async () => undefined);
  postWebhook = vi.fn(async () => ({ status: 200 }));
  adapters = {
    sendMail,
    postWebhook,
    config: {
      steward_emails: ["s1@example.com", "s2@example.com"],
      webhook_url: "https://hooks.example.com/default",
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("dispatchSideEffects — fan-out per declared channel", () => {
  it("returns empty results when the action has no side_effects declared", async () => {
    const results = await dispatchSideEffects({
      ctx: ctxSteward,
      ontology: makeOntology(),
      actionName: "silent_action",
      params: {},
      result: { ok: true },
      adapters,
    });
    expect(results).toEqual([]);
    expect(sendMail).not.toHaveBeenCalled();
    expect(postWebhook).not.toHaveBeenCalled();
  });

  it("returns skipped for audit channel (middleware already handled it)", async () => {
    const results = await dispatchSideEffects({
      ctx: ctxSteward,
      ontology: {
        ...makeOntology(),
        action_types: {
          audit_only: {
            description: "Audit-only side effect",
            function: "noop",
            permissions: ["steward"],
            agent_policy: "always_confirm",
            side_effects: ["audit"],
          },
        },
      },
      actionName: "audit_only",
      params: {},
      result: { ok: true },
      adapters,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ channel: "audit", status: "skipped" });
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("notify_member emails the actor and reports ok", async () => {
    const results = await dispatchSideEffects({
      ctx: ctxMember,
      ontology: makeOntology(),
      actionName: "change_tier",
      params: { member: "m-1", new_tier: "lifetime" },
      result: { ok: true, new_tier: "lifetime" },
      adapters,
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "member@example.com",
        subject: expect.stringContaining("change_tier"),
      }),
    );
    const member = results.find((r) => r.channel === "notify_member");
    expect(member?.status).toBe("ok");
  });

  it("notify_member is skipped when actor has no email", async () => {
    const anonCtx = createCtx({
      db,
      actor: { ...memberActor, email: "" },
    });
    const results = await dispatchSideEffects({
      ctx: anonCtx,
      ontology: makeOntology(),
      actionName: "change_tier",
      params: {},
      result: { ok: true },
      adapters,
    });
    expect(sendMail).not.toHaveBeenCalled();
    const r = results.find((r) => r.channel === "notify_member");
    expect(r?.status).toBe("skipped");
  });

  it("notify_steward emails every steward in config", async () => {
    const results = await dispatchSideEffects({
      ctx: ctxSteward,
      ontology: makeOntology(),
      actionName: "add_member",
      params: { full_name: "Ada", email: "ada@x.com" },
      result: { ok: true, member: "m-99" },
      adapters,
    });
    expect(sendMail).toHaveBeenCalledTimes(2);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "s1@example.com" }),
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "s2@example.com" }),
    );
    const r = results.find((r) => r.channel === "notify_steward");
    expect(r?.status).toBe("ok");
  });

  it("webhook POSTs the full envelope to the configured URL", async () => {
    const results = await dispatchSideEffects({
      ctx: ctxSteward,
      ontology: makeOntology(),
      actionName: "add_member",
      params: { full_name: "Ada", email: "ada@x.com" },
      result: { ok: true, member: "m-99" },
      auditId: "audit-123",
      adapters,
    });
    expect(postWebhook).toHaveBeenCalledTimes(1);
    expect(postWebhook).toHaveBeenCalledWith({
      url: "https://hooks.example.com/default",
      body: {
        action: "add_member",
        actor: "u-steward",
        params: { full_name: "Ada", email: "ada@x.com" },
        result: { ok: true, member: "m-99" },
        audit_id: "audit-123",
      },
    });
    const r = results.find((r) => r.channel === "webhook");
    expect(r?.status).toBe("ok");
  });
});

describe("dispatchSideEffects — per-action YAML override", () => {
  it("uses side_effects_config.webhook_url instead of the env default", async () => {
    const ontology = makeOntology();
    ontology.action_types.add_member.side_effects_config = {
      webhook_url: "https://override.example.com/add-member",
    };
    await dispatchSideEffects({
      ctx: ctxSteward,
      ontology,
      actionName: "add_member",
      params: {},
      result: { ok: true },
      adapters,
    });
    expect(postWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://override.example.com/add-member",
      }),
    );
  });

  it("uses side_effects_config.steward_emails instead of the env default", async () => {
    const ontology = makeOntology();
    ontology.action_types.add_member.side_effects_config = {
      steward_emails: ["only-this@example.com"],
    };
    await dispatchSideEffects({
      ctx: ctxSteward,
      ontology,
      actionName: "add_member",
      params: {},
      result: { ok: true },
      adapters,
    });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "only-this@example.com" }),
    );
  });
});

describe("dispatchSideEffects — failure isolation", () => {
  it("captures sendMail errors per channel without throwing", async () => {
    sendMail.mockRejectedValueOnce(new Error("SMTP down"));
    const results = await dispatchSideEffects({
      ctx: ctxMember,
      ontology: makeOntology(),
      actionName: "change_tier",
      params: {},
      result: { ok: true },
      adapters,
    });
    const r = results.find((r) => r.channel === "notify_member");
    expect(r?.status).toBe("error");
    expect(r?.error).toMatch(/SMTP down/);
  });

  it("captures webhook errors per channel without throwing", async () => {
    postWebhook.mockRejectedValueOnce(new Error("502 Bad Gateway"));
    const results = await dispatchSideEffects({
      ctx: ctxSteward,
      ontology: makeOntology(),
      actionName: "add_member",
      params: {},
      result: { ok: true },
      adapters,
    });
    const r = results.find((r) => r.channel === "webhook");
    expect(r?.status).toBe("error");
    expect(r?.error).toMatch(/502 Bad Gateway/);
  });

  it("an early-channel failure does not prevent later channels from running", async () => {
    sendMail.mockRejectedValueOnce(new Error("SMTP boom"));
    const results = await dispatchSideEffects({
      ctx: ctxSteward,
      ontology: makeOntology(),
      actionName: "add_member",
      params: {},
      result: { ok: true },
      adapters,
    });
    // Even though notify_steward's first mail blew up, webhook still ran.
    expect(postWebhook).toHaveBeenCalledTimes(1);
    const channels = results.map((r: SideEffectResult) => r.channel);
    expect(channels).toContain("audit");
    expect(channels).toContain("notify_steward");
    expect(channels).toContain("webhook");
  });

  it("skips channels with missing config without erroring", async () => {
    const noConfigAdapters: SideEffectAdapters = {
      sendMail,
      postWebhook,
      config: {},
    };
    const results = await dispatchSideEffects({
      ctx: ctxSteward,
      ontology: makeOntology(),
      actionName: "add_member",
      params: {},
      result: { ok: true },
      adapters: noConfigAdapters,
    });
    const webhook = results.find((r) => r.channel === "webhook");
    expect(webhook?.status).toBe("skipped");
    expect(postWebhook).not.toHaveBeenCalled();

    const stewardR = results.find((r) => r.channel === "notify_steward");
    expect(stewardR?.status).toBe("skipped");
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("dispatchSideEffects — audit child rows (M2.4)", () => {
  // Schema decision: instead of a dedicated side_effect_audit table we
  // reuse the existing action_audit store with subject_type="side_effect",
  // subject_id=channel name, and metadata.parent_action_audit_id pointing
  // at the parent action's audit row. Same query surface, no migration,
  // and the call tree stays in one place.
  it("writes one side_effect row per dispatched channel, linked to the parent auditId", async () => {
    const audit = new InMemoryAuditStore();
    const ctxWithAudit = createCtx({
      db,
      actor: memberActor,
      audit,
    });
    await dispatchSideEffects({
      ctx: ctxWithAudit,
      ontology: makeOntology(),
      actionName: "change_tier",
      params: { member: "m-1", new_tier: "lifetime" },
      result: { ok: true, new_tier: "lifetime" },
      auditId: "parent-audit-1",
      adapters,
    });
    const rows = await audit.listActionAudit();
    const sideEffectRows = rows.filter((r) => r.subject_type === "side_effect");
    // change_tier declares [audit, notify_member]; "audit" channel is a
    // no-op for persistence (the middleware already wrote the parent row),
    // so we expect ONE side_effect row for notify_member.
    expect(sideEffectRows).toHaveLength(1);
    const notify = sideEffectRows[0];
    expect(notify.subject_id).toBe("notify_member");
    expect(notify.metadata.parent_action_audit_id).toBe("parent-audit-1");
    expect(notify.metadata.status).toBe("ok");
    expect(notify.metadata.action_type).toBe("change_tier");
  });

  it("records status=error with error message when an adapter throws", async () => {
    const audit = new InMemoryAuditStore();
    sendMail.mockRejectedValueOnce(new Error("SMTP unreachable"));
    const ctxWithAudit = createCtx({
      db,
      actor: memberActor,
      audit,
    });
    await dispatchSideEffects({
      ctx: ctxWithAudit,
      ontology: makeOntology(),
      actionName: "change_tier",
      params: {},
      result: { ok: true },
      auditId: "parent-audit-2",
      adapters,
    });
    const rows = await audit.listActionAudit();
    const notify = rows.find(
      (r) =>
        r.subject_type === "side_effect" &&
        r.subject_id === "notify_member",
    );
    expect(notify).toBeDefined();
    expect(notify!.metadata.status).toBe("error");
    expect(String(notify!.metadata.error)).toMatch(/SMTP unreachable/);
  });

  it("does not persist anything when ctx.audit is absent", async () => {
    // Bare ctx (no audit) must still dispatch and return results in memory
    // without throwing — back-compat for unit-test callers.
    const results = await dispatchSideEffects({
      ctx: ctxMember,
      ontology: makeOntology(),
      actionName: "change_tier",
      params: {},
      result: { ok: true },
      auditId: "parent-audit-3",
      adapters,
    });
    expect(results.find((r) => r.channel === "notify_member")?.status).toBe(
      "ok",
    );
  });
});

describe("loadSideEffectConfigFromEnv", () => {
  it("parses STEWARD_EMAILS as a comma-separated list", () => {
    const cfg = loadSideEffectConfigFromEnv({
      STEWARD_EMAILS: "a@x.com, b@x.com ,c@x.com",
    });
    expect(cfg.steward_emails).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
  });

  it("reads SIDE_EFFECT_WEBHOOK_URL", () => {
    const cfg = loadSideEffectConfigFromEnv({
      SIDE_EFFECT_WEBHOOK_URL: "https://hooks.example.com/x",
    });
    expect(cfg.webhook_url).toBe("https://hooks.example.com/x");
  });

  it("returns empty config when nothing is set", () => {
    const cfg = loadSideEffectConfigFromEnv({});
    expect(cfg).toEqual({});
  });
});
