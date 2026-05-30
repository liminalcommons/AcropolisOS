import path from "node:path";
import { describe, expect, it } from "vitest";
import { z, type ZodType } from "zod";
import { loadOntology } from "../ontology/load";
import {
  buildZodSchemas,
  generateZodModule,
  generateOntologyModule,
  pascalCase,
} from "./zod";

const PKG_ROOT = path.resolve(__dirname, "..", "..");
const SMALL_COMMUNITY = path.join(
  PKG_ROOT,
  "scenarios",
  "small-community", "ontology",
);

function evalModuleSource(source: string): Record<string, unknown> {
  const exportNames = [
    ...source.matchAll(/^export\s+const\s+([A-Za-z_][\w]*)/gm),
  ].map((m) => m[1]);
  const cleaned = source
    .replace(/^import\s+\{[^}]+\}\s+from\s+["']zod["'];?\s*$/gm, "")
    .replace(/^export\s+type\s+[\s\S]*?;\s*$/gm, "")
    .replace(/^export\s+const\s+/gm, "const ");
  const body = `${cleaned}\nreturn { ${exportNames.join(", ")} };`;
  const fn = new Function("z", body);
  return fn(z) as Record<string, unknown>;
}

describe("pascalCase", () => {
  it("preserves PascalCase input", () => {
    expect(pascalCase("Member")).toBe("Member");
    expect(pascalCase("MeetingMinute")).toBe("MeetingMinute");
  });

  it("converts snake_case to PascalCase", () => {
    expect(pascalCase("record_attendance")).toBe("RecordAttendance");
    expect(pascalCase("add_meeting_minute")).toBe("AddMeetingMinute");
  });

  it("converts kebab-case to PascalCase", () => {
    expect(pascalCase("meeting-minute")).toBe("MeetingMinute");
  });

  it("handles mixed cases", () => {
    expect(pascalCase("attended_at")).toBe("AttendedAt");
    expect(pascalCase("a")).toBe("A");
  });
});

describe("buildZodSchemas (runtime)", () => {
  it("builds object-type schemas keyed by PascalCase name", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const schemas = buildZodSchemas(onto);
    expect(schemas.objectSchemas.Member).toBeDefined();
    expect(schemas.objectSchemas.Event).toBeDefined();
    expect(schemas.objectSchemas.MeetingMinute).toBeDefined();
  });

  it("builds action-parameter schemas keyed by PascalCase + Params suffix", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const schemas = buildZodSchemas(onto);
    expect(schemas.actionParamSchemas.RecordAttendanceParams).toBeDefined();
    expect(schemas.actionParamSchemas.AddMemberParams).toBeDefined();
    expect(schemas.actionParamSchemas.AddMeetingMinuteParams).toBeDefined();
    expect(schemas.actionParamSchemas.ChangeTierParams).toBeDefined();
  });

  it("builds link-type schemas with Link suffix when properties exist", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const schemas = buildZodSchemas(onto);
    expect(schemas.linkSchemas.AttendedLink).toBeDefined();
  });

  it("roundtrips a representative Member row from seed", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { objectSchemas } = buildZodSchemas(onto);
    const member = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      full_name: "Ada Lovelace",
      email: "ada@example.org",
      joined_at: "2026-01-15",
      tier: "sustaining",
      notes: "founding member",
    };
    const parsed = (objectSchemas.Member as ZodType).parse(member);
    expect(parsed).toEqual(member);
  });

  it("roundtrips a representative Event row from seed", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { objectSchemas } = buildZodSchemas(onto);
    const event = {
      id: "223e4567-e89b-12d3-a456-426614174000",
      title: "Spring Equinox Gathering",
      starts_at: "2026-03-21T18:00:00Z",
      location: "Town Hall",
      description: "Annual community event",
      created_at: "2026-01-10T12:00:00Z",
    };
    const parsed = (objectSchemas.Event as ZodType).parse(event);
    expect(parsed).toEqual(event);
  });

  it("roundtrips RecordAttendanceParams from seed action", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { actionParamSchemas } = buildZodSchemas(onto);
    const params = {
      member: "123e4567-e89b-12d3-a456-426614174000",
      event: "223e4567-e89b-12d3-a456-426614174000",
      role: "organizer",
    };
    const parsed = (actionParamSchemas.RecordAttendanceParams as ZodType).parse(
      params,
    );
    expect(parsed).toEqual(params);
  });

  it("rejects an enum value not in the declared set", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { objectSchemas } = buildZodSchemas(onto);
    const result = (objectSchemas.Member as ZodType).safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      full_name: "X",
      email: "x@example.org",
      joined_at: "2026-01-15",
      tier: "bogus",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an action-param value missing a required field", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const { actionParamSchemas } = buildZodSchemas(onto);
    const result = (
      actionParamSchemas.RecordAttendanceParams as ZodType
    ).safeParse({
      event: "223e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(false);
  });
});

describe("generateZodModule (TS source)", () => {
  it("emits expected named exports for the small-community seed", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateZodModule(onto);
    expect(source).toContain('import { z } from "zod"');
    expect(source).toMatch(/export const MemberSchema\s*=/);
    expect(source).toMatch(/export const EventSchema\s*=/);
    expect(source).toMatch(/export const MeetingMinuteSchema\s*=/);
    expect(source).toMatch(/export const RecordAttendanceParamsSchema\s*=/);
    expect(source).toMatch(/export const AddMemberParamsSchema\s*=/);
    expect(source).toMatch(/export const AttendedLinkSchema\s*=/);
    expect(source).toMatch(/export type Member\s*=/);
    expect(source).toMatch(/export type Event\s*=/);
    expect(source).toMatch(/export type RecordAttendanceParams\s*=/);
  });

  it("generates a header comment marking the file as generated", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateZodModule(onto);
    expect(source).toMatch(/generated|do not edit/i);
  });

  it("generated source is evaluable and schemas roundtrip seed rows", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateZodModule(onto);
    const mod = evalModuleSource(source);
    const MemberSchema = mod.MemberSchema as ZodType;
    expect(MemberSchema).toBeDefined();
    const member = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      full_name: "Ada Lovelace",
      email: "ada@example.org",
      joined_at: "2026-01-15",
      tier: "basic",
      notes: "n/a",
    };
    expect(MemberSchema.parse(member)).toEqual(member);

    const RecordAttendanceParamsSchema =
      mod.RecordAttendanceParamsSchema as ZodType;
    expect(
      RecordAttendanceParamsSchema.parse({
        member: "123e4567-e89b-12d3-a456-426614174000",
        event: "223e4567-e89b-12d3-a456-426614174000",
        role: "attendee",
      }),
    ).toMatchObject({ role: "attendee" });
  });
});

describe("generateOntologyModule (combined)", () => {
  it("emits the tagged Ontology type and OntologySchemas map", async () => {
    const onto = await loadOntology(SMALL_COMMUNITY);
    const source = generateOntologyModule(onto);
    expect(source).toMatch(/from\s+["']\.\/types\.generated["']/);
    expect(source).toMatch(/export\s+type\s+Ontology\s*=\s*\{/);
    expect(source).toMatch(/Member:\s*Member;?/);
    expect(source).toMatch(/Event:\s*Event;?/);
    expect(source).toMatch(/MeetingMinute:\s*MeetingMinute;?/);
    expect(source).toMatch(/export\s+const\s+OntologySchemas\s*=/);
  });
});

describe("committed generated artifacts match codegen output", () => {
  it("types.generated.ts is in sync with the seed ontology", async () => {
    const { readFile } = await import("node:fs/promises");
    const onto = await loadOntology(SMALL_COMMUNITY);
    const expected = generateZodModule(onto);
    const actual = await readFile(
      path.join(PKG_ROOT, "lib", "ontology", "types.generated.ts"),
      "utf8",
    );
    expect(actual).toBe(expected);
  });

  it("ontology.generated.ts is in sync with the seed ontology", async () => {
    const { readFile } = await import("node:fs/promises");
    const onto = await loadOntology(SMALL_COMMUNITY);
    const expected = generateOntologyModule(onto);
    const actual = await readFile(
      path.join(PKG_ROOT, "lib", "ontology", "ontology.generated.ts"),
      "utf8",
    );
    expect(actual).toBe(expected);
  });
});
