import { describe, expect, it } from "vitest";
import { BACKUP_MANIFEST_VERSION, buildManifest, parseManifest } from "./manifest";

describe("buildManifest", () => {
  it("includes version, createdAt, source dirs, and audit counts", () => {
    const m = buildManifest({
      pkgName: "@chora/acropolisos",
      pkgVersion: "0.0.1",
      sourceDirs: ["ontology", "functions", "views", "uploads"],
      auditCounts: { ontology_audit: 3, action_audit: 7 },
    });
    expect(m.version).toBe(BACKUP_MANIFEST_VERSION);
    expect(m.pkg).toEqual({ name: "@chora/acropolisos", version: "0.0.1" });
    expect(m.sourceDirs).toEqual(["ontology", "functions", "views", "uploads"]);
    expect(m.auditCounts).toEqual({ ontology_audit: 3, action_audit: 7 });
    expect(new Date(m.createdAt).toString()).not.toBe("Invalid Date");
  });
});

describe("parseManifest", () => {
  it("roundtrips JSON.stringify(buildManifest)", () => {
    const m = buildManifest({
      pkgName: "@chora/acropolisos",
      pkgVersion: "0.0.1",
      sourceDirs: ["ontology"],
      auditCounts: { ontology_audit: 0, action_audit: 0 },
    });
    const parsed = parseManifest(JSON.stringify(m));
    expect(parsed).toEqual(m);
  });

  it("rejects unknown version", () => {
    const raw = JSON.stringify({ version: "v0-bogus" });
    expect(() => parseManifest(raw)).toThrow(/version/i);
  });

  it("rejects malformed JSON", () => {
    expect(() => parseManifest("not json")).toThrow();
  });
});
