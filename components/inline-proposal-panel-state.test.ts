import { describe, expect, it } from "vitest";
import { emptyDraft, type ProposalDiff } from "@/lib/proposals/diff";
import {
  CHAT_SESSION_STORAGE_KEY,
  pickLatestProposalForSession,
  proposalAvailableActions,
  summarizeProposalDiff,
} from "./inline-proposal-panel-state";

function makeDiff(overrides: Partial<ProposalDiff> = {}): ProposalDiff {
  return { ...emptyDraft(), ...overrides };
}

describe("summarizeProposalDiff", () => {
  it("lists names of new object types, link types, action types", () => {
    const diff = makeDiff({
      new_object_types: {
        Event: { properties: { id: { type: "string" } } } as never,
        Member: { properties: { id: { type: "string" } } } as never,
      },
      new_link_types: {
        EventToMember: { from: "Event", to: "Member" } as never,
      },
      new_action_types: {
        record_attendance: { params: {} } as never,
      },
    });
    const summary = summarizeProposalDiff(diff);
    expect(summary.new_object_types).toEqual(["Event", "Member"]);
    expect(summary.new_link_types).toEqual(["EventToMember"]);
    expect(summary.new_action_types).toEqual(["record_attendance"]);
  });

  it("splits new vs modified shared properties", () => {
    const diff = makeDiff({
      new_shared_properties: {
        email: { type: "string" } as never,
      },
      modified_properties: {
        name: { type: "string" } as never,
      },
    });
    const summary = summarizeProposalDiff(diff);
    expect(summary.new_shared_properties).toEqual(["email"]);
    expect(summary.modified_properties).toEqual(["name"]);
  });

  it("counts functions, views, seeds, ingests without dumping bodies", () => {
    const diff = makeDiff({
      new_functions: {
        "hello.ts": { filename: "hello.ts", ts_body: "x".repeat(5000) },
      },
      new_view_configs: {
        "role:steward": {
          scope: "role",
          scope_key: "steward",
          descriptors: [{ id: "v1", kind: "metric", config: {} }],
        },
      },
      new_seeds: {
        Event: { object_type: "Event", rows_jsonl: "{}\n" },
      },
      new_ingests: {
        inbox_a: {
          inbox_ids: ["a"],
          target_object_type: "Event",
          mapping: { from: "to" },
        },
      },
      impacted_tables: ["Event"],
    });
    const summary = summarizeProposalDiff(diff);
    expect(summary.function_count).toBe(1);
    expect(summary.view_count).toBe(1);
    expect(summary.seed_count).toBe(1);
    expect(summary.ingest_count).toBe(1);
    expect(summary.impacted_tables).toEqual(["Event"]);
  });

  it("surfaces evidence per Type.field, sorted by key", () => {
    const diff = makeDiff({
      evidence: {
        "Guest.phone": ["raw_inbox:r2"],
        "Guest.passport": ["raw_inbox:r1a", "raw_inbox:r1b"],
      },
    });
    const summary = summarizeProposalDiff(diff);
    expect(summary.evidenceByField).toEqual([
      { key: "Guest.passport", rows: ["raw_inbox:r1a", "raw_inbox:r1b"] },
      { key: "Guest.phone", rows: ["raw_inbox:r2"] },
    ]);
  });

  it("emits an empty evidenceByField for an empty draft", () => {
    expect(summarizeProposalDiff(emptyDraft()).evidenceByField).toEqual([]);
  });

  it("returns empty summary for an empty draft", () => {
    const summary = summarizeProposalDiff(emptyDraft());
    expect(summary.new_object_types).toEqual([]);
    expect(summary.new_link_types).toEqual([]);
    expect(summary.new_action_types).toEqual([]);
    expect(summary.new_shared_properties).toEqual([]);
    expect(summary.modified_properties).toEqual([]);
    expect(summary.function_count).toBe(0);
    expect(summary.view_count).toBe(0);
    expect(summary.seed_count).toBe(0);
    expect(summary.ingest_count).toBe(0);
    expect(summary.impacted_tables).toEqual([]);
    expect(summary.isEmpty).toBe(true);
  });
});

describe("proposalAvailableActions", () => {
  it("steward gets apply, edit, reject", () => {
    const actions = proposalAvailableActions("steward");
    expect(actions).toEqual(["apply", "edit", "reject"]);
  });

  it("member gets submit-for-review only", () => {
    const actions = proposalAvailableActions("member");
    expect(actions).toEqual(["submit-for-review"]);
  });

  it("anonymous (no role) gets no actions", () => {
    const actions = proposalAvailableActions(null);
    expect(actions).toEqual([]);
  });
});

describe("pickLatestProposalForSession", () => {
  it("returns the newest pending proposal for the given session", () => {
    const a = {
      id: "a",
      session_id: "s1",
      status: "pending" as const,
      created_at: "2026-05-16T10:00:00Z",
    };
    const b = {
      id: "b",
      session_id: "s1",
      status: "pending" as const,
      created_at: "2026-05-16T11:00:00Z",
    };
    const c = {
      id: "c",
      session_id: "s2",
      status: "pending" as const,
      created_at: "2026-05-16T12:00:00Z",
    };
    expect(pickLatestProposalForSession([a, b, c], "s1")?.id).toBe("b");
  });

  it("returns null when no proposal matches the session", () => {
    const a = {
      id: "a",
      session_id: "other",
      status: "pending" as const,
      created_at: "2026-05-16T10:00:00Z",
    };
    expect(pickLatestProposalForSession([a], "s1")).toBeNull();
  });

  it("ignores non-pending proposals when picking latest", () => {
    const a = {
      id: "a",
      session_id: "s1",
      status: "pending" as const,
      created_at: "2026-05-16T10:00:00Z",
    };
    const b = {
      id: "b",
      session_id: "s1",
      status: "approved" as const,
      created_at: "2026-05-16T11:00:00Z",
    };
    expect(pickLatestProposalForSession([a, b], "s1")?.id).toBe("a");
  });

  it("returns null for empty list", () => {
    expect(pickLatestProposalForSession([], "s1")).toBeNull();
  });
});

describe("CHAT_SESSION_STORAGE_KEY", () => {
  it("is namespaced under acropolisos", () => {
    expect(CHAT_SESSION_STORAGE_KEY).toMatch(/^acropolisos:/);
  });
});
