import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOntology } from "./load";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SMALL_COMMUNITY = path.join(
  PKG_ROOT,
  "seed",
  "small-community",
);
const EMPTY = path.join(PKG_ROOT, "seed", "empty");

describe("seed: small-community", () => {
  it("loads and passes integrity check", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    expect(Object.keys(onto.object_types).sort()).toEqual([
      "Event",
      "MeetingMinute",
      "Member",
      "Notification",
    ]);
    expect(Object.keys(onto.link_types).sort()).toEqual([
      "attended",
      "authored",
    ]);
    expect(Object.keys(onto.action_types).sort()).toEqual([
      "add_meeting_minute",
      "add_member",
      "change_tier",
      "delete_member",
      "invite_member",
      "promote_to_steward",
      "record_attendance",
    ]);
    expect(Object.keys(onto.roles).sort()).toEqual(["member", "steward"]);
    expect(onto.action_types.record_attendance.creates_link).toBe("attended");
    expect(onto.action_types.add_member.creates_object).toBe("Member");
  });
});

describe("seed: empty", () => {
  it("loads with only roles populated", async () => {
    const onto = await loadOntology(EMPTY);
    expect(Object.keys(onto.roles).sort()).toEqual(["member", "steward"]);
    expect(onto.object_types).toEqual({});
    expect(onto.link_types).toEqual({});
    expect(onto.action_types).toEqual({});
    expect(onto.properties).toEqual({});
  });
});
