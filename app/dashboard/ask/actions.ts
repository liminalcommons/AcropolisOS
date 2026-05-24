// F6: server actions for /dashboard/ask — chat with agent about widgets + pin them.
// "use server" at top — Next.js requirement for server action files in app router.

"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getOrCreateMemberContext } from "@/lib/me/fetchers/member-context";
import { WIDGET_KINDS } from "@/lib/me/widgets";

// Widget shape for the ask page — a superset that handles agent-proposed widgets.
// Stored into MemberContext.pinned_widgets (text column = JSON array).
export interface DashboardWidget {
  id: string;
  kind: string;
  title: string;
  props: Record<string, unknown>;
}

const PinWidgetInput = z.object({
  kind: z.enum(WIDGET_KINDS),
  title: z.string().min(1).max(120),
  props: z.record(z.string(), z.unknown()).default({}),
});

// ─── pinWidget ────────────────────────────────────────────────────────────────
//
// Appends a widget to the current user's MemberContext.pinned_widgets array.
// Called from the "Pin to dashboard" button in /dashboard/ask.
// Redirects to / so the user lands on the dashboard with the new widget visible.

export async function pinWidget(widget: DashboardWidget): Promise<void> {
  const runtime = await buildChatRuntime();
  if (isAnonymous(runtime.actor)) {
    throw new Error("unauthorized");
  }

  // Input validation — reject unknown widget kinds.
  const validatedWidget = PinWidgetInput.parse({
    kind: widget.kind,
    title: widget.title,
    props: widget.props,
  });

  const actor = runtime.actor!;
  const ctx = runtime.ctx;

  // Resolve Member row for the actor (MemberContext.member_id links to Member.id).
  const members = await ctx.objects.Member.findMany();
  const me = members.find((m) => m.id === actor.userId);
  if (!me) {
    throw new Error("no_member_row");
  }

  // Get or create the MemberContext row.
  const mc = await getOrCreateMemberContext(ctx, me.id);

  // Normalize pinned_widgets — DB stores as text (JSON string) or array.
  let pinned: DashboardWidget[] = [];
  const raw = mc.pinned_widgets;
  if (Array.isArray(raw)) {
    pinned = raw as DashboardWidget[];
  } else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) pinned = parsed as DashboardWidget[];
    } catch {
      // start fresh if corrupt
    }
  }

  // Append the new widget with a guaranteed fresh ID.
  const toPin: DashboardWidget = {
    ...validatedWidget,
    id: `pin_${randomUUID()}`,
  };
  const next = [...pinned, toPin];

  // Update MemberContext — write back the JSON array as a string.
  await ctx.objects.MemberContext.update(mc.id, {
    pinned_widgets: JSON.stringify(next),
    updated_at: new Date().toISOString(),
  });

  revalidatePath("/");
  redirect("/");
}
