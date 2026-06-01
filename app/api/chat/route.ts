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
import { readOrgProfile } from "@/lib/org-profile/store";
import { orgPurposePreamble } from "@/lib/org-profile/shared";
import { getDb } from "@/lib/db/client";
import { raw_inbox } from "@/lib/db/schema";
import { chatPasteRow } from "@/lib/inbox/stage-text";
import {
  composeOrgView,
  removeOrgView,
  clearOrgView,
} from "@/lib/org-dashboard/compose-view";
import { CATALOG_KINDS } from "@/lib/widgets/catalog";

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
  "  - ingest_text: when the user PASTES raw data as text in chat (a list or dump of records, 'here are our guests: …'), call ingest_text with that text to stage it in the raw inbox for classification + growth. Prefer this over proposing object types directly from a paste — stage the data first, then it can be classified at /organize.",
  "  - propose_* + finalize_proposal: stage ONTOLOGY changes (new object/link/property/action types, new ingest mappings). These DO NOT mutate live state until a steward reviews and applies the proposal.",
  "  - list_pending_proposals + withdraw_proposal: when the user asks to CORRECT, UNDO, REPLACE, or 'fix' a proposal you already finalized, do NOT stack a second proposal and tell the steward to cherry-pick. Instead: if you don't already have the id, call list_pending_proposals to find the stale one; call withdraw_proposal({proposal_id}) to retract it; then re-stage the corrected version with propose_* + finalize_proposal. Only withdraw a proposal YOU created in this kind of correction flow — never silently retract a proposal the user did not ask you to change.",
  "  - CONSERVATIVE CORRECTION (CRITICAL): a correction is a MINIMAL DELTA, not a fresh model. When you re-propose to correct an existing proposal, you MUST start from the ORIGINAL proposal's exact definition — first read it back from list_pending_proposals (or describe_<type>) so you have its precise current shape. Carry over UNCHANGED: the object type's `kind`, its `title_property`, its `permissions`, and EVERY existing property (name, type, required, and any other attribute) exactly as they were. Then apply ONLY the one specific change the user requested (e.g. add a single field). Do NOT re-model the type from scratch, do NOT change the `kind` (e.g. agent → resource), do NOT drop, rename, retype, or reorder any property the user did not explicitly ask you to change, and do NOT 'improve' or normalize fields on your own initiative. If the user asks to add a field, the corrected proposal is the original PLUS that one field — nothing else differs. If you are unsure of the original's exact shape, read it again before re-proposing rather than reconstructing it from memory.",
  "  - apply_action: invoke a typed action to mutate LIVE state immediately (e.g., change_tier on an existing Member, record_attendance). These commit when called.",
  "  - n8n (list_workflows, create_workflow): inspect and create automation workflows in n8n. Use list_workflows when the user asks what automations exist or what's connected. Use create_workflow when the user asks to set up an automation or materialize an action path as a workflow. If either tool returns 'n8n not connected', inform the user the API key needs to be configured.",
  "  - design_theme: when the user asks to re-skin / re-color the app ('make the theme oceanic', 'give me a warm earthy palette', 'I want a high-contrast theme'), call design_theme with their described look. It designs a structurally + accessibility-validated palette and applies it for the current member. Tell the user it's applied (or report the reason if it returns ok:false).",
  "  - compose_view: when the steward asks to show/add a table, list, metric, or calendar of some type on the org dashboard ('show me a table of guests on the dashboard', 'add a count of open shifts', 'put the bookings on /org'), call compose_view with the widget kind (data_table | roster | metric | calendar), the ontology type, and the columns/fields they want. You may also pass an optional `title` to label the widget (e.g. 'Open shifts'); if omitted it defaults to the prettified type name. The view appears on /org immediately — no approval step. Calling compose_view again for the same type+kind REPLACES that widget. If it returns ok:false, tell the user the reason (e.g. you are not authorized to read that type).",
    "  - remove_widget / clear_dashboard: when the steward asks to remove or take off a specific widget from the org dashboard, call remove_widget with the same kind+type used to compose it; when they ask to reset, empty, or clear the whole dashboard, call clear_dashboard. Both apply immediately and are steward-only (they return ok:false otherwise).",
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
      // SHAPE only (z.string()): the SET of valid types is ontology-derived, not a
      // fixed enum. Type MEMBERSHIP is enforced SERVER-SIDE at execution by
      // composeOrgView → validateWidgetConfig (deriveVocabulary gate), never at the
      // tool schema — so any loaded ontology's types work without re-emitting the tool.
      type: z
        .string()
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
        .describe(
          "Optional field=value filter for data_table or metric (e.g. {field:'status', value:'open'}). " +
            "Use the relative token value '@today' to filter a date field to the current date " +
            "(e.g. {field:'from_date', value:'@today'} = arriving today).",
        ),
      limit: z.number().int().optional().describe("Max rows (optional)."),
      title: z
        .string()
        .max(120)
        .optional()
        .describe(
          "Optional human-readable label for the widget card header (e.g. 'Open shifts'). If omitted, defaults to the prettified type name.",
        ),
    }),
    execute: async ({ kind, type, columns, filter, limit, title }) => {
      // Write-auth is now STRUCTURAL: composeOrgView REQUIRES canWriteDashboard
      // and gates on it FIRST (fail-closed), before the per-type read fence. The
      // steward-only role check lives in the core — there is no separate gate
      // here that could be forgotten on a future call site.
      const canWriteDashboard = composeActor.role === "steward";
      const r = await composeOrgView(
        { kind, type, columns, filter, limit, title },
        {
          canReadType: buildCanReadType(composeActor, composeOntology),
          canWriteDashboard,
          ontology: composeOntology,
        },
      );
      if (!r.ok) return { ok: false, reason: r.reason };
      return {
        ok: true,
        applied: true,
        summary: `Added a ${kind} of ${type} to the org dashboard.`,
      };
    },
  });

  // Step-2b: remove_widget — take a single composed widget off the org dashboard.
  // Same structural write-auth as compose_view (canWriteDashboard gated FIRST in
  // the core). Idempotent — removing an absent widget still returns ok:true.
  const remove_widget = tool({
    description:
      "Remove a single composed widget from the steward org dashboard (/org), identified by the same kind + type used to compose it. Applies immediately.",
    inputSchema: z.object({
      kind: z
        .enum(CATALOG_KINDS)
        .describe("The widget kind to remove: data_table | roster | metric | calendar."),
      // SHAPE only (z.string()): membership is enforced server-side at execution
      // (removeOrgView targets a stable id; an unknown type simply matches nothing).
      type: z
        .string()
        .describe("The ontology type of the widget to remove, e.g. guest, shift, booking."),
    }),
    execute: async ({ kind, type }) => {
      const canWriteDashboard = composeActor.role === "steward";
      const r = await removeOrgView({ kind, type }, { canWriteDashboard });
      if (!r.ok) return { ok: false, reason: r.reason };
      return {
        ok: true,
        applied: true,
        summary: r.existed
          ? `Removed the ${kind} of ${type} from the org dashboard.`
          : `No ${kind} of ${type} was on the org dashboard.`,
      };
    },
  });

  // Step-2b: clear_dashboard — reset the org dashboard to its default. Same
  // structural write-auth (canWriteDashboard gated FIRST in the core).
  const clear_dashboard = tool({
    description:
      "Reset the steward org dashboard (/org) to its default, removing all composed widgets. Applies immediately.",
    inputSchema: z.object({}),
    execute: async () => {
      const canWriteDashboard = composeActor.role === "steward";
      const r = await clearOrgView({ canWriteDashboard });
      if (!r.ok) return { ok: false, reason: r.reason };
      return {
        ok: true,
        applied: true,
        summary: "Reset the org dashboard to its default.",
      };
    },
  });

  // ingest_text — the "paste your mess in chat" intake channel (storyboard
  // Scene 3). Stages pasted free-text into raw_inbox so /organize + the GROW
  // loop classify + grow it. The route is already past the isAnonymous gate, so
  // the caller is an authenticated member (same bar as /api/connect/upload).
  const ingest_text = tool({
    description:
      "Stage raw data the user PASTES into chat (a list/dump of records, e.g. 'here are our 128 guests: …') into the raw inbox so it can be classified and grown into the ontology. Use this when the user pastes records as prose instead of uploading a file — do NOT try to propose object types directly from a paste; stage it first. After staging, tell the user it's in the inbox and they can classify/grow it at /organize.",
    inputSchema: z.object({
      text: z.string().min(1).describe("the pasted free-text data to stage"),
      label: z
        .string()
        .optional()
        .describe("optional short label for what this data is, e.g. 'guests' or 'bookings'"),
    }),
    execute: async ({ text, label }) => {
      const [row] = await getDb()
        .insert(raw_inbox)
        .values(chatPasteRow(text, label))
        .returning({ id: raw_inbox.id });
      return {
        ok: true,
        id: row?.id,
        message:
          "Staged your text in the raw inbox. Review + classify it at /organize, or ask me to propose structure from it.",
      };
    },
  });

  const tools = {
    ...readTools,
    ...proposalTools,
    // Omitted entirely when the actor can invoke no actions (buildApplyActionAiSdkTool
    // returns null) — a degenerate apply_action schema otherwise fails the whole
    // request on strict providers (DeepSeek: `type: null`).
    ...(applyActionTool ? { apply_action: applyActionTool } : {}),
    ...meReadTools,
    ...n8nTools,
    design_theme,
    compose_view,
    remove_widget,
    clear_dashboard,
    ingest_text,
  };

  // Gap ②: inject the org's PURPOSE so the agent weighs proposals + answers by
  // fit-to-purpose (rank, not just validate). Read-only context; absent = omitted.
  const purposePreamble = orgPurposePreamble((await readOrgProfile())?.purpose);

  const result = streamText({
    model: buildLanguageModel(),
    system: `${purposePreamble}${AGENT_INSTRUCTIONS}${APPLY_ACTION_INSTRUCTIONS}`,
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
