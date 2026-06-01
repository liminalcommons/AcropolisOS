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
  "scenarios",
  "hostel", "ontology",
);

describe("inngestFunctionIdFor", () => {
  it("namespaces by action name", () => {
    expect(inngestFunctionIdFor("log_incident")).toBe(
      "acropolisos-action-log_incident",
    );
  });
});

describe("inngestEventNameFor", () => {
  it("namespaces by action name", () => {
    expect(inngestEventNameFor("log_incident")).toBe(
      "acropolisos/action.log_incident",
    );
  });
});

describe("generateInngestActionsModule (seed: hostel)", () => {
  it("emits one inngest.createFunction per declarative action, skipping function-backed", async () => {
    const ontology = await loadOntology(SEED_DIR);
    const out = generateInngestActionsModule(ontology);

    // check_in is function-backed (handled by US-025) and must NOT appear here.
    expect(out).not.toContain("acropolisos-action-check_in");
    expect(out).not.toContain("acropolisos/action.check_in");

    // The two seed declarative actions must each produce a function.
    for (const action of ["log_incident", "start_work_trade"]) {
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
    expect(out).toContain("actionLogIncident");
    expect(out).toContain("actionStartWorkTrade");
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

    // For log_incident, the function must wire actionName + ctx and source
    // params from the event payload (via the `payload` local extracted from
    // event.data — US-030 introduced the indirection so audit_pre + the
    // declarative step share the same params binding).
    expect(out).toMatch(
      /runDeclarativeAction\(\{\s*actionName:\s*"log_incident"/,
    );
    expect(out).toMatch(/const payload\s*=\s*\(event\.data/);
    expect(out).toMatch(/const params\s*=\s*payload\.params/);
    expect(out).toContain("ctx");
  });

  it("emits an enforceActionPermission step before the runner (US-032)", async () => {
    const ontology = await loadOntology(SEED_DIR);
    const out = generateInngestActionsModule(ontology);

    expect(out).toContain("enforceActionPermission");
    expect(out).toMatch(
      /from\s+"\.\.\/actions\/permission-check"/,
    );
    // For each declarative action: a permission-check step is registered.
    for (const action of [
      "log_incident",
      "start_work_trade",
    ]) {
      expect(out).toContain(`"permission-check.${action}"`);
      // The permission check is emitted ahead of the declarative step in
      // source order — short of parsing the AST, we use the index check.
      const checkIdx = out.indexOf(`"permission-check.${action}"`);
      const runIdx = out.indexOf(`"declarative.${action}"`);
      expect(checkIdx).toBeGreaterThan(-1);
      expect(runIdx).toBeGreaterThan(-1);
      expect(checkIdx).toBeLessThan(runIdx);
    }
  });

  it("emits audit_pre / audit_post steps wrapping the action body (US-030)", async () => {
    const ontology = await loadOntology(SEED_DIR);
    const out = generateInngestActionsModule(ontology);

    expect(out).toContain("auditPreInvocation");
    expect(out).toContain("auditPostInvocation");
    expect(out).toMatch(/from\s+"\.\.\/actions\/audit-middleware"/);

    // Each declarative action gets matching audit step ids and they bracket
    // the permission-check + declarative steps in source order.
    for (const action of [
      "log_incident",
      "start_work_trade",
    ]) {
      expect(out).toContain(`"audit-pre.${action}"`);
      expect(out).toContain(`"audit-post.${action}"`);
      const preIdx = out.indexOf(`"audit-pre.${action}"`);
      const permIdx = out.indexOf(`"permission-check.${action}"`);
      const runIdx = out.indexOf(`"declarative.${action}"`);
      const postIdx = out.indexOf(`"audit-post.${action}"`);
      expect(preIdx).toBeGreaterThan(-1);
      expect(preIdx).toBeLessThan(permIdx);
      expect(permIdx).toBeLessThan(runIdx);
      expect(runIdx).toBeLessThan(postIdx);
    }
  });

  it("short-circuits the body when audit_pre reports a replay (US-030)", async () => {
    const ontology = await loadOntology(SEED_DIR);
    const out = generateInngestActionsModule(ontology);
    // Generated source must branch on the replay result before running the
    // permission-check + declarative steps.
    expect(out).toMatch(/kind\s*===\s*"replay"/);
    expect(out).toContain("priorResult");
  });

  it("emits a side-effects step after audit_post on the success path (US-028)", async () => {
    const ontology = await loadOntology(SEED_DIR);
    const out = generateInngestActionsModule(ontology);

    expect(out).toContain("dispatchSideEffects");
    expect(out).toMatch(/from\s+"\.\.\/actions\/side-effects"/);

    for (const action of [
      "log_incident",
      "start_work_trade",
    ]) {
      expect(out).toContain(`"side-effects.${action}"`);
      const postIdx = out.indexOf(`"audit-post.${action}"`);
      const sideIdx = out.indexOf(`"side-effects.${action}"`);
      expect(sideIdx).toBeGreaterThan(postIdx);
    }
  });
});
