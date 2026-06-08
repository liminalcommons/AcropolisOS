import { describe, expect, it } from "vitest";
import { parseStewardEmails, resolveRole } from "@/lib/auth/steward";

describe("parseStewardEmails", () => {
  it("returns an empty set when unset or blank", () => {
    expect(parseStewardEmails(undefined).size).toBe(0);
    expect(parseStewardEmails("").size).toBe(0);
    expect(parseStewardEmails("   ").size).toBe(0);
  });

  it("splits on commas and/or whitespace, lowercasing + trimming", () => {
    const s = parseStewardEmails("  Alice@X.com, bob@y.com\n  CAROL@z.com ");
    expect(s).toEqual(new Set(["alice@x.com", "bob@y.com", "carol@z.com"]));
  });

  it("drops empty entries from stray separators", () => {
    expect(parseStewardEmails("a@x.com,,, ,b@x.com")).toEqual(
      new Set(["a@x.com", "b@x.com"]),
    );
  });
});

describe("resolveRole", () => {
  const stewards = parseStewardEmails("steward@x.com, boss@y.com");

  it("maps a listed email to steward (case-insensitive)", () => {
    expect(resolveRole("steward@x.com", stewards)).toBe("steward");
    expect(resolveRole("  STEWARD@X.com ", stewards)).toBe("steward");
  });

  it("maps an unlisted email to member", () => {
    expect(resolveRole("rando@x.com", stewards)).toBe("member");
  });

  it("fail-closed: missing/blank email is a member, never steward", () => {
    expect(resolveRole(null, stewards)).toBe("member");
    expect(resolveRole(undefined, stewards)).toBe("member");
    expect(resolveRole("", stewards)).toBe("member");
    expect(resolveRole("anything@x.com", new Set())).toBe("member");
  });
});
