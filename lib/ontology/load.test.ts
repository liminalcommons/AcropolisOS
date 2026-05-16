import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadOntology, OntologyValidationError } from "./load";

async function makeRoot(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "acropolisos-ontology-"));
}

async function writeOntologyFiles(
  root: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body, "utf8");
  }
}

describe("loadOntology", () => {
  let root: string;

  beforeEach(async () => {
    root = await makeRoot();
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("loads a valid seed ontology", async () => {
    await writeOntologyFiles(root, {
      "properties.yaml": `
email:
  type: email
joined_at:
  type: date
`,
      "roles.yaml": `
member:
  description: Anyone in the community
steward:
  description: Trusted operator
`,
      "object-types/member.yaml": `
Member:
  description: A person
  properties:
    id: { type: uuid, primary_key: true }
    full_name: { type: string }
    email: { ref: email }
`,
      "link-types.yaml": `
attended:
  from: Member
  to: Event
  cardinality: many-to-many
`,
      "action-types/record-attendance.yaml": `
record_attendance:
  description: Record attendance
  creates_link: attended
  permissions: [steward]
  agent_policy: auto_apply
`,
    });

    const onto = await loadOntology(root);
    expect(onto.properties.email.type).toBe("email");
    expect(onto.roles.steward.description).toContain("operator");
    expect(onto.object_types.Member.properties.full_name).toEqual({
      type: "string",
    });
    expect(onto.link_types.attended.cardinality).toBe("many-to-many");
    expect(onto.action_types.record_attendance.agent_policy).toBe("auto_apply");
  });

  it("surfaces file path and JSON pointer when an object type is invalid", async () => {
    await writeOntologyFiles(root, {
      "object-types/broken.yaml": `
Broken:
  properties:
    id: { type: not_a_real_type }
`,
    });

    await expect(loadOntology(root)).rejects.toBeInstanceOf(
      OntologyValidationError,
    );

    try {
      await loadOntology(root);
    } catch (err) {
      const e = err as OntologyValidationError;
      expect(e.file).toMatch(/broken\.yaml$/);
      expect(e.pointer).toBe("/Broken");
      expect(e.message).toContain("/properties/id");
    }
  });

  it("rejects a missing required field with a precise pointer", async () => {
    await writeOntologyFiles(root, {
      "link-types.yaml": `
bad_link:
  from: A
  cardinality: many-to-many
`,
    });

    try {
      await loadOntology(root);
      expect.fail("should have thrown");
    } catch (err) {
      const e = err as OntologyValidationError;
      expect(e).toBeInstanceOf(OntologyValidationError);
      expect(e.message).toContain("/to");
    }
  });

  it("returns an empty aggregate when the root has no ontology files", async () => {
    const onto = await loadOntology(root);
    expect(onto.properties).toEqual({});
    expect(onto.object_types).toEqual({});
  });
});
