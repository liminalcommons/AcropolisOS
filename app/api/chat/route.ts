// M2.2 step-5: chat route now wires apply_action alongside propose_*.
//
// Per-request setup:
//   1. buildChatRuntime() resolves the actor (auth().session or sentinel),
//      loads the ontology, builds the OntologyCtx + PG audit store, and
//      identifies functionsDir.
//   2. createInProcessDispatcher routes apply_action calls through the same
//      audit-pre + permission-check + handler + audit-post pipeline as the
//      durable Inngest path.
//   3. buildApplyActionAiSdkTool emits the ai-sdk tool shape (discriminated
//      union narrowed to actor-permitted action types). M3.8 #35: the schema
//      does NOT include bypass_confirmation — the Confirm button POSTs
//      directly to /api/chat/confirm which sets the flag server-side.
//   4. Tools record merges proposal tools (vibe-coding) + apply_action
//      (committed mutations). The agent picks the right surface per request.

import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { AGENT_INSTRUCTIONS, buildLanguageModel } from "@/lib/agent/mastra";
import { buildAiSdkProposalTools } from "@/lib/proposals/ai-sdk-tools";
import { getProposalStore } from "@/lib/proposals/singleton";
import { getInboxStore } from "@/lib/inbox/singleton";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { createInProcessDispatcher } from "@/lib/actions/dispatcher";
import { buildApplyActionAiSdkTool } from "@/lib/agent/apply-action-ai-sdk";
import { buildMeReadTools } from "@/lib/agent/read-tools-me";
import { buildN8nReadTools } from "@/lib/agent/n8n-tools";
import { designTheme } from "@/lib/theme/design";
import { getOrCreateMemberContext } from "@/lib/me/fetchers/member-context";
import { buildCanReadType } from "@/lib/widgets/read-api";
import { composeOrgView } from "@/lib/org-dashboard/compose-view";
import { CATALOG_KINDS, CATALOG_VALID_TYPES } from "@/lib/widgets/catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ChatRequestBody {
  messages: UIMessage[];
  session_id?: string;
}

function isChatRequestBody(value: unknown): value is ChatRequestBody {
  if (!value || typeof value !== "object") return false;
  const msgs = (value as { messages?: unknown }).messages;
  return Array.isArray(msgs);
}

// Extended instructions: tell the agent when apply_action vs propose_* is
// appropriate, and that read tools must come FIRST when the user is asking
// "what do we have" rather than "let's change something".
const APPLY_ACTION_INSTRUCTIONS = [
  "",
  "You have FOUR surfaces:",
  "  - READ (query_<type>, read_<type>, describe_<type>): inspect existing data. When the user asks about existing data ('what X do we have', 'show me', 'list', 'how many', 'who is …'), use query_<type> or read_<type> FIRST, before proposing anything new. Use describe_<type> when you need to know what fields an object type has.",
  "  - propose_* + finalize_proposal: stage ONTOLOGY changes (new object/link/property/action types, new ingest mappings). These DO NOT mutate live state until a steward reviews and applies the proposal.",
  "  - apply_action: invoke a typed action to mutate LIVE state immediately (e.g., change_tier on an existing Member, record_attendance). These commit when called.",
  "  - n8n (list_workflows, create_workflow): inspect and create automation workflows in n8n. Use list_workflows when the user asks what automations exist or what's connected. Use create_workflow when the user asks to set up an automation or materialize an action path as a workflow. If either tool returns 'n8n not connected', inform the user the API key needs to be configured.",
  "  - design_theme: when the user asks to re-skin / re-color the app ('make the theme oceanic', 'give me a warm earthy palette', 'I want a high-contrast theme'), call design_theme with their described look. It designs a structurally + accessibility-validated palette and applies it for the current member. Tell the user it's applied (or report the reason if it returns ok:false).",
  "  - compose_view: when the steward asks to show/add a table, list, metric, or calendar of some type on the org dashboard ('show me a table of guests on the dashboard', 'add a count of open shifts', 'put the bookings on /org'), call compose_view with the widget kind (data_table | roster | metric | calendar), the ontology type, and the columns/fields they want. The view appears on /org immediately — no approval step. Calling compose_view again for the same type+kind REPLACES that widget. If it returns ok:false, tell the user the reason (e.g. you are not authorized to read that type).",
  "Rules: never propose a new object type the ontology already has — call describe_<type> or query_<type> first to verify. Use apply_action only when the user asks to do something on the live data and the action_type already exists. If they ask for new behavior, propose first.",
  "Some actions have a confirmation policy. If apply_action returns confirmation_required, present the requested change in your text reply and let the user click the Confirm button — do NOT attempt to re-call apply_action yourself.",
].join(" ");

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isChatRequestBody(body)) {
    return Response.json({ error: "missing_messages" }, { status: 400 });
  }

  const session_id =
    typeof body.session_id === "string" && body.session_id
      ? body.session_id
      : `anon-${Math.random().toString(36).slice(2, 10)}`;

  const runtime = await buildChatRuntime();

  // M3.8 (#33): refuse anonymous callers BEFORE wiring the dispatcher,
  // proposal tools, or streamText. Without this gate the steward-local
  // sentinel previously granted unauthenticated POSTs full apply_action
  // access. ANONYMOUS_ACTOR now has zero permissions, but we still
  // short-circuit to avoid building/streaming any agent surface for an
  // unauthenticated request.
  if (isAnonymous(runtime.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const dispatcher = createInProcessDispatcher({
    ctx: runtime.ctx,
    ontology: runtime.ontology,
    functionsDir: runtime.functionsDir,
    // M2.4: forward env-resolved adapters so notify_member fires after
    // every successful apply_action and the dispatch results land as
    // child action_audit rows linked to the parent.
    sideEffectAdapters: runtime.sideEffectAdapters,
  });

  const applyActionTool = buildApplyActionAiSdkTool({
    actor: runtime.actor,
    ontology: runtime.ontology,
    ctx: runtime.ctx,
    dispatcher,
  });

  const proposalTools = buildAiSdkProposalTools(
    getProposalStore(),
    session_id,
    getInboxStore(),
  );

  // Object-type read tools (query_<type>/read_<type>/describe_<type>) built
  // per-request in chat-runtime so the actor's permissions are baked in.
  const readTools = runtime.readTools ?? {};

  // M4.3: wire /me read tools (query_member_context + query_my_blockers).
  // runtime.actor is non-null here: isAnonymous() is a type guard, so the
  // 401 short-circuit above narrowed actor to Actor on this branch.
  const meReadTools = buildMeReadTools({
    ctx: runtime.ctx,
    actor: runtime.actor,
    ontology: runtime.ontology,
  });

  // F2-step2b: n8n read tools (list_workflows). Wired unconditionally — the
  // tool itself fails soft to an error message if N8N_API_KEY is absent.
  const n8nTools = buildN8nReadTools();

  // P5: design_theme — the senior-color-expert agent surface. designTheme()
  // governs structure (18-key TokenSet) + accessibility (WCAG contrast floor)
  // before anything is applied. On success it persists theme_pref for the
  // current member (same write path as app/theme-actions.ts applyThemeAction),
  // resolving the Member row from the actor exactly like pinWidget.
  const themeCtx = runtime.ctx;
  const themeActor = runtime.actor;
  const design_theme = tool({
    description:
      "Design and apply a new UI color theme for the current member from a description. The palette is validated for structure and accessibility (WCAG contrast) before it is applied.",
    inputSchema: z.object({
      prompt: z
        .string()
        .describe("The desired look, e.g. 'warm earthy tones' or 'high-contrast oceanic'"),
      dataContext: z.string().optional(),
    }),
    execute: async ({ prompt, dataContext }) => {
      const r = await designTheme({ prompt, dataContext });
      if (r.status !== "ok") return { ok: false, reason: r.reason };
      const members = await themeCtx.objects.Member.findMany();
      const me = members.find((m) => m.id === themeActor.userId);
      if (!me) return { ok: false, reason: "no_member_row" };
      const mc = await getOrCreateMemberContext(themeCtx, me.id);
      await themeCtx.objects.MemberContext.update(mc.id, {
        theme_pref: JSON.stringify(r.tokens),
        updated_at: new Date().toISOString(),
      });
      return { ok: true, applied: true, summary: `Applied a new theme (${prompt}).` };
    },
  });

  // Step-2b KEYSTONE: compose_view — the agent composes a GOVERNED widget view
  // onto the steward /org dashboard. The view is a catalog widget descriptor
  // (NOT free-form code); composeOrgView validates kind/type/columns against the
  // catalog schemas AND gates on the actor's per-type read permission
  // (buildCanReadType, fail-closed — same fence the render path uses) before
  // persisting. The composed view appears immediately (no approval gate).
  const composeActor = runtime.actor;
  const composeOntology = runtime.ontology;
  const compose_view = tool({
    description:
      "Compose a governed widget view onto the steward org dashboard (/org). A view is a catalog widget (data_table, roster, metric, or calendar) over an ontology type — not free-form code. The widget appears immediately. Re-composing the same type+kind replaces that widget.",
    inputSchema: z.object({
      kind: z
        .enum(CATALOG_KINDS)
        .describe("The widget kind: data_table | roster | metric | calendar."),
      type: z
        .enum(CATALOG_VALID_TYPES)
        .describe("The ontology type to display, e.g. guest, shift, booking, event."),
      columns: z
        .array(z.string())
        .optional()
        .describe(
          "For data_table/roster: the columns/fields to show. For calendar: the date field as the single element. Ignored for metric.",
        ),
      filter: z
        .object({ field: z.string(), value: z.string() })
        .optional()
        .describe("Optional field=value filter (metric only)."),
      limit: z.number().int().optional().describe("Max rows (optional)."),
    }),
    execute: async ({ kind, type, columns, filter, limit }) => {
      // WRITE-AUTHORIZATION: the org dashboard is a single shared admin surface
      // (one steward view). Composing MUTATES it, so restrict the write to
      // stewards — a non-steward can't view /org and must not reshape it.
      // (The per-type read fence below is necessary but not sufficient: public
      // types like bed/shift would otherwise let any member mutate the board.)
      if (composeActor.role !== "steward") {
        return { ok: false, reason: "Only a steward can compose the org dashboard." };
      }
      // Build the read fence from THIS request's actor + ontology — the same
      // predicate the /org render path gates every read with. Fail-closed:
      // an actor who cannot read the type cannot compose a widget over it.
      const canReadType = buildCanReadType(composeActor, composeOntology);
      const r = await composeOrgView(
        { kind, type, columns, filter, limit },
        canReadType,
      );
      if (!r.ok) return { ok: false, reason: r.reason };
      return {
        ok: true,
        applied: true,
        summary: `Added a ${kind} of ${type} to the org dashboard.`,
      };
    },
  });

  const tools = {
    ...readTools,
    ...proposalTools,
    apply_action: applyActionTool,
    ...meReadTools,
    ...n8nTools,
    design_theme,
    compose_view,
  };

  const result = streamText({
    model: buildLanguageModel(),
    system: `${AGENT_INSTRUCTIONS}${APPLY_ACTION_INSTRUCTIONS}`,
    messages: await convertToModelMessages(body.messages),
    tools,
    stopWhen: stepCountIs(8),
  });
  // M2.3 step-3: emit the UI message stream so tool outputs (apply_action
  // confirmation_required envelopes, audit_id, propose_* results) reach the
  // client's useChat({messages}) state as structured parts. toTextStreamResponse
  // would concatenate only text deltas and silently drop tool result frames,
  // leaving the chat panel's confirmation card permanently inert.
  return result.toUIMessageStreamResponse();
}
