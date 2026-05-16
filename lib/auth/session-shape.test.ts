import { describe, expect, it } from "vitest";
import { enrichJwt, enrichSession } from "./session-shape";

const KNOWN_CUSTOM = new Set(["finance", "facilitator"]);

describe("enrichJwt", () => {
  it("merges userId/email/role/customRoles into the token on sign-in", () => {
    const token = enrichJwt(
      { sub: undefined },
      {
        id: "u-1",
        email: "alice@example.com",
        role: "steward",
        customRoles: ["finance"],
      },
    );
    expect(token).toMatchObject({
      sub: "u-1",
      email: "alice@example.com",
      role: "steward",
      customRoles: ["finance"],
    });
  });

  it("returns the token untouched when no user is present (subsequent calls)", () => {
    const input = {
      sub: "u-1",
      email: "a@b",
      role: "member" as const,
      customRoles: [],
    };
    expect(enrichJwt(input, undefined)).toEqual(input);
  });
});

describe("enrichSession", () => {
  it("projects userId/email/role/customRoles from the token onto session.user", () => {
    const session = enrichSession(
      { user: { name: null } },
      {
        sub: "u-1",
        email: "alice@example.com",
        role: "steward",
        customRoles: ["finance"],
      },
      KNOWN_CUSTOM,
    );
    expect(session.user).toMatchObject({
      userId: "u-1",
      email: "alice@example.com",
      role: "steward",
      customRoles: ["finance"],
    });
  });

  it("filters customRoles down to roles that exist in the known set", () => {
    const session = enrichSession(
      { user: {} },
      {
        sub: "u-1",
        email: "a@b",
        role: "member",
        customRoles: ["finance", "gone-from-yaml"],
      },
      KNOWN_CUSTOM,
    );
    expect(session.user).toMatchObject({ customRoles: ["finance"] });
  });

  it("defaults role to 'member' and customRoles to [] when token is incomplete", () => {
    const session = enrichSession(
      { user: {} },
      { sub: "u-1", email: "a@b" },
      KNOWN_CUSTOM,
    );
    expect(session.user).toMatchObject({
      userId: "u-1",
      email: "a@b",
      role: "member",
      customRoles: [],
    });
  });
});
