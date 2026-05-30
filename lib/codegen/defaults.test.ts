import { describe, expect, it } from "vitest";
import { isDynamicDefaultToken, tokenToSqlDefault } from "./defaults";

describe("isDynamicDefaultToken", () => {
  it("returns true for dynamic date/timestamp tokens", () => {
    expect(isDynamicDefaultToken("@today")).toBe(true);
    expect(isDynamicDefaultToken("@now")).toBe(true);
    expect(isDynamicDefaultToken("@today+7d")).toBe(true);
    expect(isDynamicDefaultToken("@today-3d")).toBe(true);
  });

  it("returns false for static values and malformed tokens", () => {
    expect(isDynamicDefaultToken("EUR")).toBe(false);
    expect(isDynamicDefaultToken("booked")).toBe(false);
    expect(isDynamicDefaultToken(false)).toBe(false);
    expect(isDynamicDefaultToken(5)).toBe(false);
    expect(isDynamicDefaultToken("@yesterday")).toBe(false);
  });
});

describe("tokenToSqlDefault", () => {
  it("maps base tokens to their SQL expression", () => {
    expect(tokenToSqlDefault("@today", "date")).toBe("CURRENT_DATE");
    expect(tokenToSqlDefault("@now", "timestamp")).toBe("now()");
  });

  it("maps offset date tokens to interval arithmetic", () => {
    expect(tokenToSqlDefault("@today+7d", "date")).toBe("(CURRENT_DATE + 7)");
    expect(tokenToSqlDefault("@today+30d", "date")).toBe("(CURRENT_DATE + 30)");
  });
});
