// US-022: Reload toast display formatting.

import { describe, expect, it } from "vitest";
import { formatReloadToast } from "./toast-message";

describe("formatReloadToast", () => {
  it("renders the ontology reload message", () => {
    expect(
      formatReloadToast({ kind: "ontology", at: 0, paths: ["m.yaml"] }),
    ).toBe("Reloading ontology…");
  });

  it("renders the view reload message", () => {
    expect(
      formatReloadToast({
        kind: "view",
        at: 0,
        paths: ["views/Member/list.tsx"],
      }),
    ).toBe("Reloading views…");
  });

  it("falls back to a generic message for unexpected kinds", () => {
    expect(formatReloadToast({ kind: "all", at: 0, paths: [] })).toBe(
      "Reloading…",
    );
  });
});
