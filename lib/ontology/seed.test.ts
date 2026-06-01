import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOntology } from "./load";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SMALL_COMMUNITY = path.join(
  PKG_ROOT,
  "scenarios",
  "small-community", "ontology",
);
const EMPTY = path.join(PKG_ROOT, "scenarios", "empty", "ontology");

describe("seed: small-community", () => {
  it("loads and passes integrity check", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    expect(Object.keys(onto.object_types).sort()).toEqual([
      "AgentBlocker",
      "Event",
      "MeetingMinute",
      "Member",
      "MemberContext",
      "Notification",
    ]);
    expect(Object.keys(onto.link_types).sort()).toEqual([
      "attended",
      "authored",
    ]);
    expect(Object.keys(onto.action_types).sort()).toEqual([
      "change_tier",
      "dismiss_blocker",
      "flag_blocker",
      "mark_notification_read",
      "promote_to_steward",
      "resolve_blocker_with_custom",
      "resolve_blocker_with_input",
      "resolve_blocker_with_pathway",
    ]);
    expect(Object.keys(onto.roles).sort()).toEqual(["member", "steward"]);
  });
});

describe("seed: empty", () => {
  it("loads with roles and minimal seed content", async () => {
    const onto = await loadOntology(EMPTY);
    expect(Object.keys(onto.roles).sort()).toEqual(["member", "steward"]);
    expect(Object.keys(onto.object_types).sort()).toEqual(["member"]);
    expect(onto.link_types).toEqual({});
    expect(Object.keys(onto.action_types).sort()).toEqual(["post_announcement"]);
  });
});
