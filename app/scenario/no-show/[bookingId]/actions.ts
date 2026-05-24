// F7 — server action for the no-show scenario chooser.
//
// chooseScenario(formData): validates auth, resolves actor's member row,
// writes an incident_log row recording the chosen scenario, then redirects
// to / so the dashboard no longer shows the card.
//
// NO real execution this cycle — no Stripe charge, no automated message.
// The choice is recorded as an incident_log entry; n8n workflow
// materialization is stubbed in the UI footnote and lands in F2.

"use server";

import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import {
  booking as bookingTable,
  incident_log as incidentLogTable,
  member as memberTable,
} from "@/lib/db/schema.generated";
import { serverNow } from "@/lib/me/today";

const SCENARIOS = [
  "charge_50pct_no_show_fee",
  "try_once_more_contact",
  "full_refund_free_bed",
] as const;

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
      body: `Booking ${parsed.bookingId} — manager selected scenario: "${parsed.scenario}". No automated action executed this cycle (n8n workflow materialization pending F2).`,
      category: "no_show_resolution",
      severity: "info",
      occurred_at: serverNow(),
      reported_by: byEmail.id,
      resolved: true,
      resolution_notes: `Scenario: ${parsed.scenario}`,
    });
    redirect("/");
  }

  await db.insert(incidentLogTable).values({
    summary: `No-show scenario chosen: ${parsed.scenario}`,
    body: `Booking ${parsed.bookingId} — manager selected scenario: "${parsed.scenario}". No automated action executed this cycle (n8n workflow materialization pending F2).`,
    category: "no_show_resolution",
    severity: "info",
    occurred_at: serverNow(),
    reported_by: actorMember.id,
    resolved: true,
    resolution_notes: `Scenario: ${parsed.scenario}`,
  });

  redirect("/");
}
