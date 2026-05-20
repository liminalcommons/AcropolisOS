// M3.8 step-4: /inbox server actions must refuse anonymous callers
// (closes #38). They were inheriting the steward-local sentinel from
// buildChatRuntime, which let any unauthenticated POST mark
// notifications on the steward's inbox.
//
// We mock buildChatRuntime to return an anonymous actor and assert both
// exported actions throw before invoking the action pipeline or touching
// the ctx.notifications store.

import { describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above imports — keep mock state inside the factory
// or use vi.hoisted() so the bound variables exist at call time.
const mocks = vi.hoisted(() => ({
  invokeActionMock: vi.fn(async () => ({})),
  markAllReadMock: vi.fn(async () => {}),
}));

vi.mock("@/lib/agent/chat-runtime", () => ({
  buildChatRuntime: async () => ({
    actor: {
      userId: "anonymous",
      email: "",
      role: "anonymous",
      customRoles: [] as string[],
    },
    ctx: {
      actor: null,
      notifications: { markAllRead: mocks.markAllReadMock },
    },
    ontology: {
      object_types: {},
      link_types: {},
      property_types: {},
      action_types: {},
      roles: {},
      ingest_mappings: {},
    },
    functionsDir: "",
    sideEffectAdapters: {},
  }),
  isAnonymous: (actor: { role?: string } | null) =>
    actor === null || actor.role === "anonymous",
}));

vi.mock("@/lib/actions/invoke", () => ({
  invokeAction: mocks.invokeActionMock,
}));

vi.mock("@/lib/actions/side-effects-runtime", () => ({
  resolveSideEffectAdapters: () => ({}),
}));

vi.mock("@/lib/actions/side-effects", () => ({
  loadSideEffectConfigFromEnv: () => ({}),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "./actions";

describe("/inbox server actions — anonymous rejection (M3.8 #38)", () => {
  it("markNotificationReadAction throws for anonymous actor without invoking action pipeline", async () => {
    await expect(markNotificationReadAction("notif-1")).rejects.toThrow(
      "unauthorized",
    );
    expect(mocks.invokeActionMock).not.toHaveBeenCalled();
  });

  it("markAllNotificationsReadAction throws for anonymous actor without touching the store", async () => {
    await expect(markAllNotificationsReadAction()).rejects.toThrow(
      "unauthorized",
    );
    expect(mocks.markAllReadMock).not.toHaveBeenCalled();
  });
});
