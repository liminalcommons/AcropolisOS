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
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import {
  incident_log as incidentLogTable,
  member as memberTable,
} from "@/lib/db/schema.generated";
import { serverNow } from "@/lib/me/today";

export async function chooseScenario(formData: FormData): Promise<never> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) {
    redirect("/signin");
  }

  const bookingId = (formData.get("bookingId") as string | null) ?? "";
  const scenario = (formData.get("scenario") as string | null) ?? "";

  if (!bookingId || !scenario) {
    redirect("/");
  }

  const db = getDb();
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
      summary: `No-show scenario chosen: ${scenario}`,
      body: `Booking ${bookingId} — manager selected scenario: "${scenario}". No automated action executed this cycle (n8n workflow materialization pending F2).`,
      category: "no_show_resolution",
      severity: "info",
      occurred_at: serverNow(),
      reported_by: byEmail.id,
      resolved: true,
      resolution_notes: `Scenario: ${scenario}`,
    });
    redirect("/");
  }

  await db.insert(incidentLogTable).values({
    summary: `No-show scenario chosen: ${scenario}`,
    body: `Booking ${bookingId} — manager selected scenario: "${scenario}". No automated action executed this cycle (n8n workflow materialization pending F2).`,
    category: "no_show_resolution",
    severity: "info",
    occurred_at: serverNow(),
    reported_by: actorMember.id,
    resolved: true,
    resolution_notes: `Scenario: ${scenario}`,
  });

  redirect("/");
}
