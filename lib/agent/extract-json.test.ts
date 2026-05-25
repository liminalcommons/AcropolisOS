import { describe, it, expect } from "vitest";
import { extractJson } from "./extract-json";

describe("extractJson", () => {
  it("returns plain JSON unchanged", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
  it("strips ```json fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("strips bare ``` fences", () => {
    expect(extractJson('```\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("extracts the first {...last } from surrounding prose", () => {
    expect(extractJson('Sure! {"a":1} hope that helps')).toBe('{"a":1}');
  });
});
