// app/api/channels/bindings/route.ts
//
// The steward's channel-binding management API. STRICTLY data-only:
//   - reads raw_inbox (via discoverChannels) + channel_bindings only,
//   - writes channel_bindings only,
//   - NEVER touches the ontology ctx, NEVER reads/writes auth, NEVER runs actions.
//
// FENCE: steward-gated, mirroring app/api/organize/grow/route.ts — anonymous → 401,
// non-steward → 403, BEFORE any db/store touch. The webhook routes' control flow is
// untouched; this route only curates which discovered targets are allow-listed.
//
//   GET  → merged steward-scoped channels view (discovery + bindings + liveness).
//   POST → { action: "bind" | "ignore" | "toggle" | "relabel", platform, external_id,
//            sub_id?, scope?, title?, label?, enabled? } mutating channel_bindings.

import { z } from "zod";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { getDb } from "@/lib/db/client";
import { discoverChannels } from "@/lib/channels/discovery";
import {
  listBindings,
  bindTarget,
  ignoreTarget,
  setEnabled,
  relabel,
  mergeDiscoveryWithBindings,
} from "@/lib/channels/bindings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Per-platform "is the webhook/token wired up" — the SAME env flags the webhook
// routes 503 on. Kept here (not in the env-free store) so the store stays testable.
function configuredFlags(): { telegram: boolean; discord: boolean } {
  return {
    telegram: Boolean(process.env.TELEGRAM_WEBHOOK_SECRET),
    discord: Boolean(process.env.DISCORD_PUBLIC_KEY),
  };
}

// — steward gate (copied byte-for-byte in spirit from organize/grow) —
async function requireSteward(): Promise<Response | null> {
  const rt = await buildChatRuntime();
  if (isAnonymous(rt.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (rt.actor.role !== "steward") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(_req: Request): Promise<Response> {
  const gate = await requireSteward();
  if (gate) return gate;

  const db = getDb();
  const [discovery, bindings] = await Promise.all([discoverChannels(db), listBindings(db)]);
  const items = mergeDiscoveryWithBindings(discovery, bindings, {
    configured: configuredFlags(),
    now: Date.now(),
  });
  return Response.json({ ok: true, items });
}

const Body = z.object({
  action: z.enum(["bind", "ignore", "toggle", "relabel"]),
  platform: z.string().min(1),
  external_id: z.string().min(1),
  sub_id: z.string().optional(),
  scope: z.string().optional(),
  title: z.string().optional(),
  label: z.string().optional(),
  enabled: z.boolean().optional(),
});

export async function POST(req: Request): Promise<Response> {
  const gate = await requireSteward();
  if (gate) return gate;

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const b = parsed.data;
  const key = { platform: b.platform, external_id: b.external_id, sub_id: b.sub_id ?? "" };

  const db = getDb();
  switch (b.action) {
    case "bind":
      await bindTarget(db, { ...key, scope: b.scope ?? "group", title: b.title, label: b.label });
      break;
    case "ignore":
      await ignoreTarget(db, { ...key, scope: b.scope });
      break;
    case "toggle":
      await setEnabled(db, key, b.enabled ?? true);
      break;
    case "relabel":
      await relabel(db, key, b.label ?? "");
      break;
  }

  return Response.json({ ok: true });
}
