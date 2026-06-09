// The card dispatch is pure and node-testable (no DOM): given a widget's status
// + legacy validation_error, which card variant renders? error wins over drift
// wins over the kind renderer.
//
// ResolvedWidgetCard.tsx imports @/lib/widgets/row-action.server, whose
// transitive chain (chat-runtime → @/lib/auth → next-auth) vitest cannot resolve
// in the node env. The same convention used by app/me/actions.test.ts and
// app/inbox/actions.test.ts applies: stub @/lib/agent/chat-runtime (the next-auth
// gateway) so the module collects. widgetCardVariant itself touches none of it.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/agent/chat-runtime", () => ({
  buildChatRuntime: async () => ({}),
  isAnonymous: () => true,
}));

import { widgetCardVariant } from "./ResolvedWidgetCard";

describe("widgetCardVariant", () => {
  it("status:error → 'error' (load failure beats everything)", () => {
    expect(widgetCardVariant({ status: "error" })).toBe("error");
  });
  it("status:drift → 'drift'", () => {
    expect(widgetCardVariant({ status: "drift" })).toBe("drift");
  });
  it("legacy validation_error (no status) → 'drift' (back-compat)", () => {
    expect(widgetCardVariant({ status: "ok", validation_error: { kind: "x", error: "y" } })).toBe("drift");
  });
  it("status:ok / empty → 'render'", () => {
    expect(widgetCardVariant({ status: "ok" })).toBe("render");
    expect(widgetCardVariant({ status: "empty" })).toBe("render");
  });
});
