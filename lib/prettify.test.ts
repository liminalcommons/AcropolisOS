import { describe, it, expect } from "vitest";
import { prettify } from "./prettify";

describe("prettify", () => {
  it("capitalises a single lowercase word", () => {
    expect(prettify("member")).toBe("Member");
  });

  it("splits snake_case into capitalised words", () => {
    expect(prettify("add_member")).toBe("Add Member");
    expect(prettify("meeting_minute")).toBe("Meeting Minute");
  });

  it("splits PascalCase into capitalised words", () => {
    expect(prettify("MeetingMinute")).toBe("Meeting Minute");
  });

  it("splits camelCase into capitalised words", () => {
    expect(prettify("meetingMinute")).toBe("Meeting Minute");
  });

  it("handles mixed snake + PascalCase tokens", () => {
    expect(prettify("add_MeetingMinute")).toBe("Add Meeting Minute");
  });

  it("returns empty string unchanged", () => {
    expect(prettify("")).toBe("");
  });
});
