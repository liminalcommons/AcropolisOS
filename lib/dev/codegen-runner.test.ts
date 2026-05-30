// US-022: Codegen runner — wraps the same flow as scripts/generate-ontology.ts
// in a reusable function so the dev watcher (and tests) can drive it without
// spawning npm.

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, beforeEach, afterAll } from "vitest";
import { runOntologyCodegen } from "./codegen-runner";

const fixtureRoot = path.resolve(__dirname, ".__codegen_fixture__");

async function writeFixture(): Promise<void> {
  const seedDir = path.join(fixtureRoot, "scenarios", "tiny", "ontology");
  const objectsDir = path.join(seedDir, "object-types");
  const actionsDir = path.join(seedDir, "action-types");
  await mkdir(objectsDir, { recursive: true });
  await mkdir(actionsDir, { recursive: true });
  await writeFile(
    path.join(seedDir, "properties.yaml"),
    "joined_at:\n  type: timestamp\n",
    "utf8",
  );
  await writeFile(path.join(seedDir, "roles.yaml"), "steward: {}\n", "utf8");
  await writeFile(path.join(seedDir, "link-types.yaml"), "{}\n", "utf8");
  await writeFile(
    path.join(objectsDir, "member.yaml"),
    [
      "Member:",
      "  permissions:",
      "    read: ['*']",
      "    write: ['steward']",
      "  properties:",
      "    id:",
      "      type: uuid",
      "      primary_key: true",
      "    full_name:",
      "      type: string",
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(actionsDir, "add-member.yaml"),
    [
      "add_member:",
      "  creates_object: Member",
      "  parameters:",
      "    full_name:",
      "      type: string",
      "      required: true",
      "  permissions: [steward]",
      "",
    ].join("\n"),
    "utf8",
  );
}

beforeEach(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
  await writeFixture();
});

afterAll(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});

describe("runOntologyCodegen", () => {
  it("emits the five generated files from a fresh fixture", async () => {
    const result = await runOntologyCodegen({
      pkgRoot: fixtureRoot,
      seedName: "tiny",
    });

    expect(result.wrote).toEqual(
      expect.arrayContaining([
        path.join(fixtureRoot, "lib", "ontology", "types.generated.ts"),
        path.join(fixtureRoot, "lib", "ontology", "ontology.generated.ts"),
        path.join(fixtureRoot, "lib", "agent", "tools.generated.ts"),
        path.join(fixtureRoot, "lib", "db", "schema.generated.ts"),
        path.join(
          fixtureRoot,
          "lib",
          "inngest",
          "declarative-actions.generated.ts",
        ),
      ]),
    );

    const types = await readFile(
      path.join(fixtureRoot, "lib", "ontology", "types.generated.ts"),
      "utf8",
    );
    // Smoke: emitted module mentions the Member type the fixture declares.
    expect(types).toMatch(/Member/);
  });

  it("reflects YAML edits on subsequent invocations (the smoke loop)", async () => {
    await runOntologyCodegen({ pkgRoot: fixtureRoot, seedName: "tiny" });
    const before = await readFile(
      path.join(fixtureRoot, "lib", "db", "schema.generated.ts"),
      "utf8",
    );
    expect(before).not.toMatch(/nickname/);

    // Edit member.yaml — add a new property — and re-run codegen.
    const memberYaml = [
      "Member:",
      "  permissions:",
      "    read: ['*']",
      "    write: ['steward']",
      "  properties:",
      "    id:",
      "      type: uuid",
      "      primary_key: true",
      "    full_name:",
      "      type: string",
      "    nickname:",
      "      type: string",
      "",
    ].join("\n");
    await writeFile(
      path.join(
        fixtureRoot,
        "scenarios",
        "tiny",
        "ontology",
        "object-types",
        "member.yaml",
      ),
      memberYaml,
      "utf8",
    );

    await runOntologyCodegen({ pkgRoot: fixtureRoot, seedName: "tiny" });
    const after = await readFile(
      path.join(fixtureRoot, "lib", "db", "schema.generated.ts"),
      "utf8",
    );
    expect(after).toMatch(/nickname/);
  });
});
