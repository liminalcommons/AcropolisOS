// M2.2 step-5: chat-runtime builder.
//
// Centralizes the per-request setup needed to wire apply_action into the
// chat route. Pulled into its own module so the route test can replace it
// with an in-memory fixture via vi.mock — keeping route.ts free of the
// branching that would otherwise be needed for hermetic tests.
//
// Returns the actor (from auth().session, falling back to a steward sentinel
// so dev / SSR-without-session still functions like the apply route does),
// the ontology (loaded from disk), the functionsDir (where function-backed
// action handlers live), and a fully-wrapped OntologyCtx.

import path from "node:path";
import { getDb } from "../db/client";
import { auth } from "../auth";
import type { Actor } from "../ctx";
import { loadOntology } from "../ontology/load";
import type { Ontology } from "../ontology/schema";
import {
  createOntologyCtxForActor,
} from "../ontology/ctx-runtime";
import type { OntologyCtx } from "../ontology/ctx";
import { getRuntimeOntologyDir } from "../setup/paths";
import {
  loadSideEffectConfigFromEnv,
  type SideEffectAdapters,
} from "../actions/side-effects";
import { resolveSideEffectAdapters } from "../actions/side-effects-runtime";

export interface ChatRuntime {
  actor: Actor | null;
  ctx: OntologyCtx;
  ontology: Ontology;
  functionsDir: string;
  // M2.4: side-effect adapters chosen by env (Resend if RESEND_API_KEY
  // present, structured-JSON stdout otherwise). The route forwards these
  // into createInProcessDispatcher so notify_member fires after every
  // successful apply_action.
  sideEffectAdapters: SideEffectAdapters;
}

// Lazily-cached ontology — disk reads are non-trivial and the ontology
// changes only on /apply, after which the Next.js process restarts.
let cachedOntology: Ontology | null = null;
let cachedOntologyDir: string | null = null;

async function getOntologyCached(dir: string): Promise<Ontology> {
  if (cachedOntology && cachedOntologyDir === dir) return cachedOntology;
  const ontology = await loadOntology(dir);
  cachedOntology = ontology;
  cachedOntologyDir = dir;
  return ontology;
}

export async function buildChatRuntime(): Promise<ChatRuntime> {
  const session = await auth().catch(() => null);
  // Mirror the fallback used by /api/proposals/[id]/apply: when no session,
  // use a steward sentinel so single-user / dev installs still work. Audit
  // metadata records this sentinel verbatim — it never disappears.
  const userInfo = session?.user as
    | { userId?: string; email?: string; role?: string }
    | undefined;
  const actor: Actor | null = userInfo?.userId
    ? {
        userId: String(userInfo.userId),
        email: String(userInfo.email ?? ""),
        role: userInfo.role === "steward" ? "steward" : "member",
        customRoles: [],
      }
    : {
        userId: "steward-local",
        email: "steward@local",
        role: "steward",
        customRoles: [],
      };

  const ontologyDir = getRuntimeOntologyDir();
  const ontology = await getOntologyCached(ontologyDir);
  const db = getDb();
  const ctx = createOntologyCtxForActor({ actor, db, ontology });
  const functionsDir = path.join(
    process.env.ACROPOLISOS_PKG_ROOT ?? process.cwd(),
    "functions",
  );
  const sideEffectAdapters = resolveSideEffectAdapters(
    loadSideEffectConfigFromEnv(process.env),
  );
  return { actor, ctx, ontology, functionsDir, sideEffectAdapters };
}
