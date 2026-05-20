// M2.2 step-5: chat-runtime builder.
//
// Centralizes the per-request setup needed to wire apply_action into the
// chat route. Pulled into its own module so the route test can replace it
// with an in-memory fixture via vi.mock — keeping route.ts free of the
// branching that would otherwise be needed for hermetic tests.
//
// M3.8 (#33/#37/#38): when auth() returns null we no longer fall back to a
// steward sentinel — that gave unauthenticated callers steward-level
// apply_action access through /api/chat, and the same fallback bled into
// /inbox + the inbox server actions. The fallback now produces an
// ANONYMOUS actor (role: "anonymous", customRoles: []) which fails every
// permission check (no action_type lists "anonymous" in its tokens) and
// every isAnonymous()-gated route returns 401 / redirects to /signin.
// We keep a sentinel rather than removing the fallback so /setup,
// /signin, /claim and other public-by-design routes can still transit
// chat-runtime without crashing on a null actor reference.

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
import type { Tool } from "ai";
import { buildReadToolsAiSdk } from "./read-tools-ai-sdk";

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
  // M2.x: ai-sdk-shaped READ tools (query_<type>, read_<type>, describe_<type>
  // per ontology object type). Lets the agent answer "what X do we have?"
  // before proposing anything new. Built per-request so permissions track
  // the current actor.
  readTools: Record<string, Tool>;
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

// M3.8: zero-permission sentinel actor. Returned from buildChatRuntime
// when auth() resolves null. Routes that perform privileged work MUST
// gate on isAnonymous(runtime.actor) and short-circuit (401, redirect,
// or thrown error) before invoking the dispatcher, exposing tools, or
// reading other members' rows.
export const ANONYMOUS_ACTOR: Actor = Object.freeze({
  userId: "anonymous",
  email: "",
  role: "anonymous",
  customRoles: [],
}) as Actor;

export function isAnonymous(actor: Actor | null): boolean {
  return actor === null || actor.role === "anonymous";
}

export async function buildChatRuntime(): Promise<ChatRuntime> {
  const session = await auth().catch(() => null);
  // M3.8: no more steward-local fallback. When auth() returns null we
  // produce the zero-permission ANONYMOUS_ACTOR so the audit pipeline
  // still records a non-null actor, but every permission check fails
  // closed. Callers gate on isAnonymous() to reject the request before
  // any privileged work is performed.
  const userInfo = session?.user as
    | { userId?: string; email?: string; role?: string }
    | undefined;
  const actor: Actor = userInfo?.userId
    ? {
        userId: String(userInfo.userId),
        email: String(userInfo.email ?? ""),
        role: userInfo.role === "steward" ? "steward" : "member",
        customRoles: [],
      }
    : ANONYMOUS_ACTOR;

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
  const readTools = buildReadToolsAiSdk({ ontology, ctx });
  return {
    actor,
    ctx,
    ontology,
    functionsDir,
    sideEffectAdapters,
    readTools,
  };
}
