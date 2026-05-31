import { parse as parseYaml } from "yaml";
import { ProposalDiff } from "@/lib/proposals/diff";
import {
  ProposalNotFoundError,
} from "@/lib/proposals/store";
import { getProposalStore } from "@/lib/proposals/singleton";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export async function GET(
  _req: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const runtime_ctx = await buildChatRuntime();
  if (isAnonymous(runtime_ctx.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const proposal = await getProposalStore().getProposal(id);
  if (!proposal) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  return Response.json({ proposal });
}

export async function PATCH(
  req: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const runtime_ctx = await buildChatRuntime();
  if (isAnonymous(runtime_ctx.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const yamlDiff =
    body && typeof body === "object" && "yaml_diff" in body
      ? (body as { yaml_diff: unknown }).yaml_diff
      : null;
  if (typeof yamlDiff !== "string") {
    return Response.json(
      { error: "missing_yaml_diff" },
      { status: 400 },
    );
  }
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlDiff);
  } catch {
    return Response.json({ error: "invalid_yaml" }, { status: 400 });
  }
  const valid = ProposalDiff.safeParse(parsed);
  if (!valid.success) {
    return Response.json(
      { error: "invalid_diff", issues: valid.error.flatten() },
      { status: 400 },
    );
  }
  try {
    const updated = await getProposalStore().updateProposalDiff(
      id,
      valid.data,
    );
    return Response.json({ proposal: updated });
  } catch (err) {
    if (err instanceof ProposalNotFoundError) {
      return Response.json({ error: "not_found" }, { status: 404 });
    }
    throw err;
  }
}

// Revisable proposals: hard-WITHDRAW a pending proposal. Steward-gated (mirrors
// the apply route's role check). Withdraw DELETES the row outright — distinct
// from /reject, which keeps a status=rejected tombstone — so a corrected
// proposal replaces rather than stacks. Returns { ok, removed }; 404 when no
// pending row matched (unknown id or already approved/rejected).
export async function DELETE(
  _req: Request,
  ctx: RouteCtx,
): Promise<Response> {
  const runtime_ctx = await buildChatRuntime();
  if (isAnonymous(runtime_ctx.actor)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (runtime_ctx.actor.role !== "steward") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await ctx.params;
  const removed = await getProposalStore().withdraw(id);
  return Response.json({ ok: true, removed }, { status: removed ? 200 : 404 });
}
