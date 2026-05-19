// M2.2 step-3: production OntologyCtx builder.
//
// Bridges:
//   - the live Postgres ontology store (createPgOntologyStore)
//   - the live action_audit / ontology_audit tables (PgAuditStore)
//   - the actor (from auth().session)
//   - the per-actor permission wrapper (createCtx in ctx.ts)
//
// Used by /api/chat/route.ts (M2.2 step 5) to construct the ctx fed to
// createInProcessDispatcher and the apply_action tool.

import type { Database } from "../db/client";
import type { Actor } from "../ctx";
import { PgAuditStore } from "../proposals/adapters/runtime";
import {
  buildObjectPermissionsMap,
  createCtx,
  type OntologyCtx,
} from "./ctx";
import { createPgOntologyStore } from "./pg-store";
import type { Ontology } from "./schema";

export interface CreateOntologyCtxForActorInput {
  actor: Actor | null;
  db: Database;
  ontology: Ontology;
}

export function createOntologyCtxForActor(
  input: CreateOntologyCtxForActorInput,
): OntologyCtx {
  const { actor, db, ontology } = input;
  const store = createPgOntologyStore(db);
  const audit = new PgAuditStore(db);
  const permissions = buildObjectPermissionsMap(ontology);
  return createCtx({ db: store, actor, permissions, audit });
}
