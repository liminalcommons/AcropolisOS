// F7 — server action for the no-show scenario chooser.
//
// chooseScenario(formData): validates auth, resolves actor's member row,
// writes an incident_log row recording the chosen scenario, attempts to
// materialize a draft n8n workflow named after the scenario, then redirects
// to / so the dashboard no longer shows the card.
//
// F2-step2c: n8n workflow materialization is now real (createWorkflow).
// The workflow creation is wrapped in try/catch — a failure does NOT block
// the incident_log write or the redirect. The workflow ID is appended to
// the incident_log body when available.

"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import {
  booking as bookingTable,
  guest as guestTable,
  incident_log as incidentLogTable,
  member as memberTable,
} from "@/lib/db/schema.generated";
import { serverNow } from "@/lib/me/today";
import { createWorkflow } from "@/lib/n8n/client";

const SCENARIOS = [
  "charge_50pct_no_show_fee",
  "try_once_more_contact",
  "full_refund_free_bed",
] as const;

type ScenarioId = (typeof SCENARIOS)[number];

/** Human-readable scenario labels for workflow names. */
const SCENARIO_LABELS: Record<ScenarioId, string> = {
  charge_50pct_no_show_fee: "charge 50% fee",
  try_once_more_contact: "try once more",
  full_refund_free_bed: "full refund + free bed",
};

/**
 * Attempt to create a draft n8n workflow named after the chosen scenario.
 * Returns the workflow id on success, or null if n8n is unreachable / not
 * configured. Never throws — failure is non-blocking.
 */
async function tryMaterializeWorkflow(
  scenario: ScenarioId,
  guestName: string,
  bookingId: string,
): Promise<string | null> {
  try {
    const shortId = bookingId.slice(0, 8);
    const label = SCENARIO_LABELS[scenario];
    const name = `No-show: ${label} — ${guestName} (${shortId})`.slice(0, 120);
    const result = await createWorkflow({ name });
    return result.id;
  } catch {
    // n8n not configured, unreachable, or returned an error — non-blocking.
    return null;
  }
}

const ChooseScenarioInput = z.object({
  bookingId: z.string().uuid(),
  scenario: z.enum(SCENARIOS),
});

export async function chooseScenario(formData: FormData): Promise<never> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) {
    redirect("/signin");
  }

  // Role gate — steward only.
  if (runtime.actor!.role !== "steward") {
    throw new Error("forbidden: steward only");
  }

  // Input validation — UUID + known scenario enum.
  const parsed = ChooseScenarioInput.parse({
    bookingId: formData.get("bookingId"),
    scenario: formData.get("scenario"),
  });

  const db = getDb();

  // Booking existence + status validation.
  const [bk] = await db
    .select()
    .from(bookingTable)
    .where(eq(bookingTable.id, parsed.bookingId))
    .limit(1);
  if (!bk) {
    throw new Error("booking not found");
  }
  if (bk.status !== "no_show") {
    throw new Error("booking is not a no-show; cannot resolve");
  }

  // Fetch guest name for the n8n workflow label (non-blocking if absent).
  const [guest] = await db
    .select()
    .from(guestTable)
    .where(eq(guestTable.id, bk.guest))
    .limit(1);
  const guestName = guest?.full_name ?? "Guest";

  // F2-step2c: materialize a draft n8n workflow for the chosen scenario.
  // Non-blocking — if n8n is unreachable or unconfigured, workflowId is null.
  const workflowId = await tryMaterializeWorkflow(
    parsed.scenario,
    guestName,
    parsed.bookingId,
  );

  const n8nNote = workflowId
    ? ` n8n workflow created: ${workflowId}.`
    : " n8n workflow creation skipped (not configured or unreachable).";

  const actorUserId = runtime.actor!.userId;

  // Resolve actor's member row — reported_by is a FK to member.id (UUID).
  // The actor.userId is the member UUID for authenticated steward/member accounts.
  const [actorMember] = await db
    .select()
    .from(memberTable)
    .where(eq(memberTable.id, actorUserId))
    .limit(1);

  if (!actorMember) {
    // Fallback: look up by email (guards against mismatched userId formats)
    const [byEmail] = await db
      .select()
      .from(memberTable)
      .where(eq(memberTable.email, runtime.actor!.email))
      .limit(1);
    if (!byEmail) {
      // Cannot write incident_log without a valid reported_by member.
      // Silently redirect — the choice is not recorded in this edge case.
      redirect("/");
    }
    await db.insert(incidentLogTable).values({
      summary: `No-show scenario chosen: ${parsed.scenario}`,
      body: `Booking ${parsed.bookingId} — ${guestName} — manager selected scenario: "${parsed.scenario}".${n8nNote}`,
      category: "no_show_resolution",
      severity: "info",
      occurred_at: serverNow(),
      reported_by: byEmail.id,
      resolved: true,
      resolution_notes: `Scenario: ${parsed.scenario}${workflowId ? ` | n8n: ${workflowId}` : ""}`,
    });
    redirect("/");
  }

  await db.insert(incidentLogTable).values({
    summary: `No-show scenario chosen: ${parsed.scenario}`,
    body: `Booking ${parsed.bookingId} — ${guestName} — manager selected scenario: "${parsed.scenario}".${n8nNote}`,
    category: "no_show_resolution",
    severity: "info",
    occurred_at: serverNow(),
    reported_by: actorMember.id,
    resolved: true,
    resolution_notes: `Scenario: ${parsed.scenario}${workflowId ? ` | n8n: ${workflowId}` : ""}`,
  });

  redirect("/");
}
