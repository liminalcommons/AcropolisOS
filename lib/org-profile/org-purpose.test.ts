import { describe, expect, it } from "vitest";
import {
  validateOrgPurpose,
  resolveOrgPurpose,
  orgPurposePreamble,
  mergeProfile,
  ORG_PURPOSE_MAX,
  type OrgProfile,
} from "./shared";

describe("validateOrgPurpose", () => {
  it("accepts a trimmed non-empty purpose within the cap", () => {
    expect(validateOrgPurpose("  Fill beds while keeping a calm, communal vibe  ")).toEqual({
      ok: true,
      value: "Fill beds while keeping a calm, communal vibe",
    });
  });
  it("rejects non-string, empty, and over-cap", () => {
    expect(validateOrgPurpose(123).ok).toBe(false);
    expect(validateOrgPurpose("   ").ok).toBe(false);
    expect(validateOrgPurpose("x".repeat(ORG_PURPOSE_MAX + 1)).ok).toBe(false);
  });
});

describe("resolveOrgPurpose", () => {
  it("returns the trimmed purpose or '' when unset", () => {
    expect(resolveOrgPurpose({ purpose: "  grow the co-op  " })).toBe("grow the co-op");
    expect(resolveOrgPurpose({})).toBe("");
    expect(resolveOrgPurpose(null)).toBe("");
  });
});

describe("orgPurposePreamble (agent reasoning injection)", () => {
  it("builds a purpose-aware preamble that names the purpose and asks the agent to weigh by it", () => {
    const p = orgPurposePreamble("keep beds full while protecting a calm vibe");
    expect(p).toContain("keep beds full while protecting a calm vibe");
    expect(p.toLowerCase()).toContain("purpose");
    expect(p.toLowerCase()).toMatch(/weigh|prefer|serve/);
    expect(p.endsWith(" ")).toBe(true); // safe to concat before AGENT_INSTRUCTIONS
  });
  it("returns '' when no purpose is set (agent reasons without it)", () => {
    expect(orgPurposePreamble("")).toBe("");
    expect(orgPurposePreamble("   ")).toBe("");
    expect(orgPurposePreamble(null)).toBe("");
    expect(orgPurposePreamble(undefined)).toBe("");
  });
});

describe("mergeProfile preserves other fields when patching purpose", () => {
  it("patching purpose keeps name + description intact", () => {
    const existing: OrgProfile = { name: "Riverside", description: "a hostel" };
    expect(mergeProfile(existing, { purpose: "be the friendliest hostel in town" })).toEqual({
      name: "Riverside",
      description: "a hostel",
      purpose: "be the friendliest hostel in town",
    });
  });
});
