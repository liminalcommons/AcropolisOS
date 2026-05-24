import path from "node:path";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { loadOntology } from "../ontology/load";
import { generateDrizzleModule, snakeCase } from "./drizzle";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SMALL_COMMUNITY = path.join(
  PKG_ROOT,
  "seed",
  "small-community",
  "ontology",
);

describe("snakeCase", () => {
  it("converts PascalCase to snake_case", () => {
    expect(snakeCase("Member")).toBe("member");
    expect(snakeCase("MeetingMinute")).toBe("meeting_minute");
    expect(snakeCase("Event")).toBe("event");
  });

  it("preserves snake_case input", () => {
    expect(snakeCase("attended_at")).toBe("attended_at");
    expect(snakeCase("created_at")).toBe("created_at");
  });

  it("converts kebab-case to snake_case", () => {
    expect(snakeCase("meeting-minute")).toBe("meeting_minute");
  });
});

describe("generateDrizzleModule — header and imports", () => {
  it("emits a generated-file header", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateDrizzleModule(onto);
    expect(source).toMatch(/generated|do not edit/i);
  });

  it("imports pgTable and required column builders from drizzle-orm/pg-core", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateDrizzleModule(onto);
    expect(source).toMatch(/from\s+["']drizzle-orm\/pg-core["']/);
    expect(source).toMatch(/\bpgTable\b/);
    expect(source).toMatch(/\buuid\b/);
    expect(source).toMatch(/\btext\b/);
    expect(source).toMatch(/\btimestamp\b/);
    expect(source).toMatch(/\bdate\b/);
  });
});

describe("generateDrizzleModule — object-type tables", () => {
  it("emits one pgTable per object type with snake-cased name", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateDrizzleModule(onto);
    expect(source).toMatch(/export\s+const\s+member\s*=\s*pgTable\(\s*["']member["']/);
    expect(source).toMatch(/export\s+const\s+event\s*=\s*pgTable\(\s*["']event["']/);
    expect(source).toMatch(
      /export\s+const\s+meeting_minute\s*=\s*pgTable\(\s*["']meeting_minute["']/,
    );
  });

  it("maps primitive property types to the right Drizzle column builders", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateDrizzleModule(onto);
    // Member.id is uuid PK
    expect(source).toMatch(/id:\s*uuid\(\s*["']id["']\s*\)\.primaryKey\(\)/);
    // Member.full_name is string -> text
    expect(source).toMatch(/full_name:\s*text\(\s*["']full_name["']\s*\)/);
    // Member.email is email (shared ref) -> text
    expect(source).toMatch(/email:\s*text\(\s*["']email["']\s*\)/);
    // Member.joined_at is shared "joined_at" (date)
    expect(source).toMatch(/joined_at:\s*date\(\s*["']joined_at["']\s*\)/);
    // Member.tier is enum -> text with default
    expect(source).toMatch(
      /tier:\s*text\(\s*["']tier["']\s*\)\.notNull\(\)\.default\(\s*["']basic["']\s*\)/,
    );
    // Event.starts_at is timestamp -> timestamp with timezone
    expect(source).toMatch(
      /starts_at:\s*timestamp\(\s*["']starts_at["']\s*,\s*\{\s*withTimezone:\s*true\s*\}\s*\)/,
    );
  });

  it("emits ref properties as uuid columns with .references() to the target table", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateDrizzleModule(onto);
    // MeetingMinute.event_id refs Event
    expect(source).toMatch(
      /event_id:\s*uuid\(\s*["']event_id["']\s*\)[^,]*\.references\(\s*\(\)\s*=>\s*event\.id\s*\)/,
    );
  });

  it("marks required properties .notNull()", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateDrizzleModule(onto);
    expect(source).toMatch(/title:\s*text\(\s*["']title["']\s*\)\.notNull\(\)/);
  });
});

describe("generateDrizzleModule — link tables", () => {
  it("emits a join table for many-to-many links with {from}_{link}_{to} naming", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateDrizzleModule(onto);
    expect(source).toMatch(
      /export\s+const\s+member_attended_event\s*=\s*pgTable\(\s*["']member_attended_event["']/,
    );
  });

  it("join table has FK columns to both endpoints and a composite primary key", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateDrizzleModule(onto);
    const block = source.match(/member_attended_event[\s\S]*?\n\);\s*\n/);
    expect(block).not.toBeNull();
    const join = block![0];
    expect(join).toMatch(
      /member_id:\s*uuid\(\s*["']member_id["']\s*\)[^,]*\.references\(\s*\(\)\s*=>\s*member\.id\s*\)/,
    );
    expect(join).toMatch(
      /event_id:\s*uuid\(\s*["']event_id["']\s*\)[^,]*\.references\(\s*\(\)\s*=>\s*event\.id\s*\)/,
    );
    expect(join).toMatch(/primaryKey\(\s*\{\s*columns:\s*\[\s*t\.member_id,\s*t\.event_id\s*\]/);
  });

  it("join table carries link properties (attended_at, role default)", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateDrizzleModule(onto);
    const block = source.match(/member_attended_event[\s\S]*?\n\);\s*\n/);
    expect(block).not.toBeNull();
    const join = block![0];
    expect(join).toMatch(
      /attended_at:\s*timestamp\(\s*["']attended_at["']\s*,\s*\{\s*withTimezone:\s*true\s*\}\s*\)\.notNull\(\)/,
    );
    expect(join).toMatch(
      /role:\s*text\(\s*["']role["']\s*\)\.notNull\(\)\.default\(\s*["']attendee["']\s*\)/,
    );
  });

  it("one-to-many links emit a FK column on the many-side table", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateDrizzleModule(onto);
    // authored: Member -> MeetingMinute (1:N) — FK on meeting_minute
    const block = source.match(/export const meeting_minute[\s\S]*?\n\);\s*\n/);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(
      /member_id:\s*uuid\(\s*["']member_id["']\s*\)[^,]*\.references\(\s*\(\)\s*=>\s*member\.id\s*\)/,
    );
  });
});

describe("generateDrizzleModule — stability", () => {
  it("produces byte-identical output across repeat invocations", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const a = generateDrizzleModule(onto);
    const b = generateDrizzleModule(onto);
    expect(a).toBe(b);
  });
});

describe("committed generated artifact matches codegen output", () => {
  it("lib/db/schema.generated.ts is in sync with the seed ontology", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const expected = generateDrizzleModule(onto);
    const actual = await readFile(
      path.join(PKG_ROOT, "lib", "db", "schema.generated.ts"),
      "utf8",
    );
    expect(actual).toBe(expected);
  });
});

describe("generated module is importable and exposes correct Drizzle tables", () => {
  it("exposes every object type as a pgTable with the expected columns", async () => {
    const generated = await import("../db/schema.generated");
    const { getTableConfig } = await import("drizzle-orm/pg-core");

    const member = getTableConfig(
      generated.member as Parameters<typeof getTableConfig>[0],
    );
    expect(member.name).toBe("member");
    const memberCols = member.columns.map((c) => c.name).sort();
    // Hostel-domain Member: tier_role + started_at + invite/user_id fields
    expect(memberCols).toEqual(
      ["email", "full_name", "id", "invite_code", "invite_expires_at", "notes", "phone", "started_at", "tier_role", "user_id"].sort(),
    );

    const evt = getTableConfig(
      generated.event as Parameters<typeof getTableConfig>[0],
    );
    expect(evt.name).toBe("event");
    // Hostel-domain Event: title, starts_at, duration_hours, attendance_cap, organizer, description, status
    expect(evt.columns.map((c) => c.name).sort()).toEqual(
      ["attendance_cap", "description", "duration_hours", "id", "organizer", "starts_at", "status", "title"].sort(),
    );
  });

  it("primary-key columns are flagged via Drizzle introspection", async () => {
    const generated = await import("../db/schema.generated");
    const { getTableConfig } = await import("drizzle-orm/pg-core");

    const member = getTableConfig(
      generated.member as Parameters<typeof getTableConfig>[0],
    );
    const id = member.columns.find((c) => c.name === "id");
    expect(id?.primary).toBe(true);
    expect(id?.getSQLType()).toBe("uuid");
  });

  it("timestamp columns are timestamp with time zone", async () => {
    const generated = await import("../db/schema.generated");
    const { getTableConfig } = await import("drizzle-orm/pg-core");

    const evt = getTableConfig(
      generated.event as Parameters<typeof getTableConfig>[0],
    );
    const startsAt = evt.columns.find((c) => c.name === "starts_at");
    expect(startsAt?.getSQLType()).toBe("timestamp with time zone");
    expect(startsAt?.notNull).toBe(true);
  });

  it("many-to-many join table has both endpoint FK columns (hostel domain: guest_attended_event)", async () => {
    const generated = await import("../db/schema.generated");
    const { getTableConfig } = await import("drizzle-orm/pg-core");

    const join = getTableConfig(
      generated.guest_attended_event_event as Parameters<typeof getTableConfig>[0],
    );
    expect(join.name).toBe("guest_attended_event_event");
    const cols = join.columns.map((c) => c.name).sort();
    expect(cols).toEqual(["event_id", "guest_id"].sort());
    // composite primary key
    expect(join.primaryKeys.length).toBe(1);
    const pkColNames = join.primaryKeys[0].columns.map((c) => c.name).sort();
    expect(pkColNames).toEqual(["event_id", "guest_id"].sort());
  });
});
