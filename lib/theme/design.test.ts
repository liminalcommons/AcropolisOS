import { describe, it, expect } from "vitest";
import { designTheme } from "./design";
import { BASE_TOKENS } from "./tokens";

// A valid oklch TokenSet derived from BASE_TOKENS (passes contrast).
const validJson = JSON.stringify(BASE_TOKENS);

describe("designTheme", () => {
  it("returns ok with a valid contrast-passing TokenSet", async () => {
    const r = await designTheme({ prompt: "cool indigo" }, { generate: async () => validJson });
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.tokens.background).toBeTruthy();
  });

  it("errors when the model returns non-JSON twice", async () => {
    const r = await designTheme({ prompt: "x" }, { generate: async () => "sorry, no" });
    expect(r.status).toBe("error");
  });

  it("errors when the model returns a malformed TokenSet (missing keys) twice", async () => {
    const r = await designTheme({ prompt: "x" }, { generate: async () => '{"background":"oklch(0 0 0)"}' });
    expect(r.status).toBe("error");
  });

  it("retries once, succeeding on the second attempt", async () => {
    let n = 0;
    const r = await designTheme(
      { prompt: "x" },
      { generate: async () => (n++ === 0 ? "garbage" : validJson) },
    );
    expect(n).toBe(2);
    expect(r.status).toBe("ok");
  });

  it("rejects a low-contrast TokenSet (foreground == background) on all attempts", async () => {
    const bad = JSON.stringify({ ...BASE_TOKENS, foreground: BASE_TOKENS.background });
    const r = await designTheme({ prompt: "x" }, { generate: async () => bad });
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.reason).toContain("contrast");
  });

  it("rejects a value carrying trailing CSS-injection content (schema is the guardrail)", async () => {
    const bad = JSON.stringify({ ...BASE_TOKENS, background: "oklch(0.5 0.1 200);} body{display:none}" });
    const r = await designTheme({ prompt: "x" }, { generate: async () => bad });
    expect(r.status).toBe("error");
  });
});
