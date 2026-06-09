// lib/theme/css.test.ts
import { describe, it, expect } from "vitest";
import { tokenSetToCssVars } from "@/lib/theme/css";
import { BASE_TOKENS } from "@/lib/theme/tokens";

describe("tokenSetToCssVars", () => {
  it("maps each token key to a --kebab CSS variable", () => {
    const vars = tokenSetToCssVars(BASE_TOKENS);
    expect(vars["--background"]).toBe(BASE_TOKENS.background);
    expect(vars["--primary-foreground"]).toBe(BASE_TOKENS["primary-foreground"]);
    expect(vars["--muted-foreground"]).toBe(BASE_TOKENS["muted-foreground"]);
  });
  it("produces exactly one var per token key", () => {
    const vars = tokenSetToCssVars(BASE_TOKENS);
    expect(Object.keys(vars)).toHaveLength(25);
  });
});
