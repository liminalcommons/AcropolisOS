// US-024: Inngest function emitted per declarative action_type by codegen.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadOntology } from "../ontology/load";
import {
  generateInngestActionsModule,
  inngestFunctionIdFor,
  inngestEventNameFor,
} from "./inngest";

const SEED_DIR = path.join(
  __dirname,
  "..",
  "..",
  "seed",
  "small-community",
  "ontology",
);

describe("inngestFunctionIdFor", () => {
  it("namespaces by action name", () => {
    expect(inngestFunctionIdFor("add_member")).toBe(
      "acropolisos-action-add_member",
    );
  });
});

describe("inngestEventNameFor", () => {
  it("namespaces by action name", () => {
    expect(inngestEventNameFor("add_member")).toBe(
      "acropolisos/action.add_member",
    );
  });
});

describe("generateInngestActionsModule (seed: small-community)", () => {
  it("emits one inngest.createFunction per declarative action, skipping function-backed", async () => {
    const ontology = await loadOntology(SEED_DIR);
    const out = generateInngestActionsModule(ontology);

    // change_tier is function-backed (handled by US-025) and must NOT appear here.
    expect(out).not.toContain("acropolisos-action-change_tier");
    expect(out).not.toContain("acropolisos/action.change_tier");

    // The three seed declarative actions must each produce a function.
    for (const action of ["add_member", "add_meeting_minute", "record_attendance"]) {
      expect(out).toContain(`"acropolisos-action-${action}"`);
      expect(out).toContain(`"acropolisos/action.${action}"`);
    }
  });

  it("wraps the runner: each function imports runDeclarativeAction and the loaded ontology", async () => {
    const ontology = await loadOntology(SEED_DIR);
    const out = generateInngestActionsModule(ontology);

    expect(out).toMatch(/from\s+"\.\.\/actions\/declarative"/);
    expect(out).toContain("runDeclarativeAction");
    // The runner needs an ontology — codegen embeds it inline so the
    // module is self-contained (mirrors how types.generated.ts works).
    expect(out).toMatch(/const ontology\s*:\s*Ontology\s*=/);
    expect(out).toMatch(/from\s+"\.\.\/ontology\/schema"/);
  });

  it("exports an array of all generated functions", async () => {
    const ontology = await loadOntology(SEED_DIR);
    const out = generateInngestActionsModule(ontology);
    expect(out).toMatch(/export const declarativeActionFunctions\s*=\s*\[/);
    // The generated const names follow camelCase of the action name,
    // prefixed with `action`.
    expect(out).toContain("actionAddMember");
    expect(out).toContain("actionAddMeetingMinute");
    expect(out).toContain("actionRecordAttendance");
  });

  it("marks the module as generated and pins it to inngest client", async () => {
    const ontology = await loadOntology(SEED_DIR);
    const out = generateInngestActionsModule(ontology);
    expect(out).toContain("THIS FILE IS GENERATED");
    expect(out).toMatch(/from\s+"\.\.\/inngest\/client"/);
  });
});

describe("generateInngestActionsModule — runtime semantics", () => {
  it("emits a function body that calls runDeclarativeAction with the action name + event params", async () => {
    const ontology = await loadOntology(SEED_DIR);
    const out = generateInngestActionsModule(ontology);

    // For add_member, the function must wire actionName + event.data.params + ctx.
    expect(out).toMatch(
      /runDeclarativeAction\(\{\s*actionName:\s*"add_member"/,
    );
    expect(out).toContain("event.data.params");
    expect(out).toContain("ctx");
  });
});
