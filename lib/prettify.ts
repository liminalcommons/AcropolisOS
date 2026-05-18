// Pure formatting helper. Converts ontology keys into human-readable labels.
//
// Splits on:
//   - underscore     ("meeting_minute" → ["meeting", "minute"])
//   - PascalCase     ("MeetingMinute"  → ["Meeting", "Minute"])
//   - camelCase      ("meetingMinute"  → ["meeting", "Minute"])
//
// Each token is capitalised and joined with a single space.
//
// Examples:
//   prettify("member")          → "Member"
//   prettify("add_member")      → "Add Member"
//   prettify("meeting_minute")  → "Meeting Minute"
//   prettify("MeetingMinute")   → "Meeting Minute"
//   prettify("meetingMinute")   → "Meeting Minute"
export function prettify(key: string): string {
  if (key.length === 0) return key;
  // First split on underscores, then split each chunk on PascalCase/camelCase
  // boundaries (lower→Upper transitions).
  const tokens = key
    .split("_")
    .flatMap((chunk) => chunk.split(/(?<=[a-z])(?=[A-Z])/))
    .filter((t) => t.length > 0);
  return tokens
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}
