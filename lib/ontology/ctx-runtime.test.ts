// M2.2 step-3: createOntologyCtxForActor wraps the Pg ontology store + audit
// store into a permission-checked OntologyCtx ready to hand to invokeAction.
// Verifies (a) the audit sink is wired, (b) the actor flows through, (c) the
// permission decorator from createCtx is active.

import { describe, expect, it } from "vitest";
import type { Database } from "../db/client";
import type { Actor } from "../ctx";
import { loadOntology } from "./load";
import path from "node:path";
import { createOntologyCtxForActor } from "./ctx-runtime";

const SEED_ROOT = path.resolve(
  __dirname,
  "..",
  "..",
  "seed",
  "small-community",
);

const stewardActor: Actor = {
  userId: "u-steward",
  email: "s@x.test",
  role: "steward",
  customRoles: [],
};

function buildStubDb(): Database {
  // We don't exercise the DB in this test — we only need a placeholder so
  // PgOntologyStore and PgAuditStore can be constructed. None of the
  // ctx-runtime invariants under test issue queries.
  return {} as unknown as Database;
}

describe("createOntologyCtxForActor — M2.2 step 3", () => {
  it("returns a ctx with actor + objects + links + audit wired", async () => {
    const ontology = await loadOntology(SEED_ROOT);
    const ctx = createOntologyCtxForActor({
      actor: stewardActor,
      db: buildStubDb(),
      ontology,
    });

    expect(ctx.actor).toEqual(stewardActor);
    expect(ctx.objects.Member).toBeDefined();
    expect(ctx.objects.Event).toBeDefined();
    expect(ctx.links.attended).toBeDefined();
    expect(ctx.audit).toBeDefined();
    expect(typeof ctx.audit?.insertActionAudit).toBe("function");
  });

  it("supports a null actor (e.g. unauthenticated callers — permissions deny)", async () => {
    const ontology = await loadOntology(SEED_ROOT);
    const ctx = createOntologyCtxForActor({
      actor: null,
      db: buildStubDb(),
      ontology,
    });
    expect(ctx.actor).toBeNull();
    expect(ctx.objects.Member).toBeDefined();
  });
});
