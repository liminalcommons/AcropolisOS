// M4.3 step-6: /me server actions must refuse anonymous callers (mirrors
// /inbox M3.8 #38 pattern). Auth-guard + session actor verification.

import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invokeActionMock: vi.fn(async () => ({})),
}));

vi.mock("@/lib/agent/chat-runtime", () => ({
  buildChatRuntime: async () => ({
    actor: {
      userId: "anonymous",
      email: "",
      role: "anonymous",
      customRoles: [] as string[],
    },
    ctx: { actor: null },
    ontology: { object_types: {}, link_types: {}, property_types: {}, action_types: {}, roles: {}, ingest_mappings: {} },
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
  resolveBlockerAction,
  dismissBlockerAction,
  pinWidgetAction,
  unpinWidgetAction,
} from "./actions";

describe("/me server actions — anonymous rejection (M4.3)", () => {
  it("resolveBlockerAction throws for anonymous actor without invoking pipeline", async () => {
    await expect(resolveBlockerAction("blocker-1")).rejects.toThrow("unauthorized");
    expect(mocks.invokeActionMock).not.toHaveBeenCalled();
  });

  it("dismissBlockerAction throws for anonymous actor", async () => {
    await expect(dismissBlockerAction("blocker-2")).rejects.toThrow("unauthorized");
    expect(mocks.invokeActionMock).not.toHaveBeenCalled();
  });

  it("pinWidgetAction throws for anonymous actor", async () => {
    await expect(pinWidgetAction('{"kind":"note"}')).rejects.toThrow("unauthorized");
    expect(mocks.invokeActionMock).not.toHaveBeenCalled();
  });

  it("unpinWidgetAction throws for anonymous actor", async () => {
    await expect(unpinWidgetAction("widget-id")).rejects.toThrow("unauthorized");
    expect(mocks.invokeActionMock).not.toHaveBeenCalled();
  });
});
