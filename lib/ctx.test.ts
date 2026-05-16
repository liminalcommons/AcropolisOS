import { describe, expect, it } from "vitest";
import { createCtx, type AcropolisSession } from "./ctx";

describe("createCtx", () => {
  it("returns a ctx with actor=null when there is no session", () => {
    const ctx = createCtx(null);
    expect(ctx.actor).toBeNull();
  });

  it("returns a ctx with actor=null when the session is missing a user", () => {
    const ctx = createCtx({} as AcropolisSession);
    expect(ctx.actor).toBeNull();
  });

  it("returns a ctx with the actor projected from session.user", () => {
    const ctx = createCtx({
      user: {
        userId: "u-1",
        email: "alice@example.com",
        role: "steward",
        customRoles: ["finance"],
      },
    });
    expect(ctx.actor).toEqual({
      userId: "u-1",
      email: "alice@example.com",
      role: "steward",
      customRoles: ["finance"],
    });
  });

  it("treats roles defensively — missing role defaults to 'member', missing customRoles defaults to []", () => {
    const ctx = createCtx({
      user: { userId: "u-1", email: "a@b" } as never,
    });
    expect(ctx.actor).toEqual({
      userId: "u-1",
      email: "a@b",
      role: "member",
      customRoles: [],
    });
  });
});
