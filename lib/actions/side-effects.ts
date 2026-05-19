// US-028: Side effects dispatcher.
//
// After audit_post(ok), fan out to each channel declared in
// action_type.side_effects. Channels run independently — a failure in one
// is logged and captured in the returned summary but does NOT throw.
// The action's audit envelope therefore stays "ok"; the dispatch step in
// the generated Inngest wrapper can be retried by Inngest's retry policy
// without re-running the action body (idempotency_key in audit_pre
// short-circuits a true replay).
//
// Channels:
//   audit            — no-op here; recorded as "skipped" because US-030's
//                      audit middleware already wrote the row.
//   notify_member    — email the actor at ctx.actor.email.
//   notify_steward   — email every address in side_effects_config.steward_emails
//                      (per-action override) or the env STEWARD_EMAILS default.
//   webhook          — POST { action, actor, params, result, audit_id } to
//                      side_effects_config.webhook_url (per-action override)
//                      or the env SIDE_EFFECT_WEBHOOK_URL default.

import type { OntologyCtx } from "../ontology/ctx";
import type {
  Ontology,
  SideEffectChannel,
  SideEffectsConfig,
} from "../ontology/schema";

// === Adapter interfaces ===
//
// Mailer + webhook are injected so production wires SMTP / Resend / fetch
// at the edge and tests can stub them. The dispatcher itself never imports
// nodemailer / resend / fetch directly.

export interface SendMailInput {
  to: string;
  subject: string;
  body: string;
  // M2.4: optional structured-event context. The stdout adapter writes
  // this into the JSON line; Resend/SMTP ignore it (they're free-form).
  action_type?: string;
}

export type SendMail = (input: SendMailInput) => Promise<void>;

export interface PostWebhookInput {
  url: string;
  body: Record<string, unknown>;
}

export type PostWebhook = (input: PostWebhookInput) => Promise<unknown>;

export interface SideEffectAdapters {
  sendMail: SendMail;
  postWebhook: PostWebhook;
  config: SideEffectsConfig;
}

// === Per-channel result envelope ===

export type SideEffectStatus = "ok" | "error" | "skipped";

export interface SideEffectResult {
  channel: SideEffectChannel;
  status: SideEffectStatus;
  error?: string;
  detail?: string;
}

// === Dispatch entrypoint ===

export interface DispatchSideEffectsInput {
  ctx: OntologyCtx;
  ontology: Ontology;
  actionName: string;
  params: unknown;
  result: unknown;
  auditId?: string;
  adapters: SideEffectAdapters;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function effectiveWebhookUrl(
  perAction: SideEffectsConfig | undefined,
  config: SideEffectsConfig,
): string | undefined {
  return perAction?.webhook_url ?? config.webhook_url;
}

function effectiveStewardEmails(
  perAction: SideEffectsConfig | undefined,
  config: SideEffectsConfig,
): string[] {
  return perAction?.steward_emails ?? config.steward_emails ?? [];
}

async function runNotifyMember(
  input: DispatchSideEffectsInput,
): Promise<SideEffectResult> {
  const actorEmail = input.ctx.actor?.email;
  if (!actorEmail) {
    return {
      channel: "notify_member",
      status: "skipped",
      detail: "actor has no email",
    };
  }
  try {
    await input.adapters.sendMail({
      to: actorEmail,
      subject: `[acropolisOS] ${input.actionName} completed`,
      body: JSON.stringify(
        { action: input.actionName, params: input.params, result: input.result },
        null,
        2,
      ),
      action_type: input.actionName,
    });
    return { channel: "notify_member", status: "ok" };
  } catch (err) {
    const msg = errorMessage(err);
    console.error(
      `[side-effects] notify_member failed for ${input.actionName}: ${msg}`,
    );
    return { channel: "notify_member", status: "error", error: msg };
  }
}

async function runNotifySteward(
  input: DispatchSideEffectsInput,
  perActionConfig: SideEffectsConfig | undefined,
): Promise<SideEffectResult> {
  const emails = effectiveStewardEmails(
    perActionConfig,
    input.adapters.config,
  );
  if (emails.length === 0) {
    return {
      channel: "notify_steward",
      status: "skipped",
      detail: "no steward_emails configured",
    };
  }
  const errors: string[] = [];
  for (const to of emails) {
    try {
      await input.adapters.sendMail({
        to,
        subject: `[acropolisOS] ${input.actionName} by ${input.ctx.actor?.userId ?? "<anonymous>"}`,
        body: JSON.stringify(
          {
            action: input.actionName,
            actor: input.ctx.actor?.userId ?? null,
            params: input.params,
            result: input.result,
          },
          null,
          2,
        ),
      });
    } catch (err) {
      const msg = errorMessage(err);
      errors.push(`${to}: ${msg}`);
      console.error(
        `[side-effects] notify_steward send to ${to} failed for ${input.actionName}: ${msg}`,
      );
    }
  }
  if (errors.length > 0) {
    return {
      channel: "notify_steward",
      status: "error",
      error: errors.join("; "),
    };
  }
  return { channel: "notify_steward", status: "ok" };
}

async function runWebhook(
  input: DispatchSideEffectsInput,
  perActionConfig: SideEffectsConfig | undefined,
): Promise<SideEffectResult> {
  const url = effectiveWebhookUrl(perActionConfig, input.adapters.config);
  if (!url) {
    return {
      channel: "webhook",
      status: "skipped",
      detail: "no webhook_url configured",
    };
  }
  try {
    await input.adapters.postWebhook({
      url,
      body: {
        action: input.actionName,
        actor: input.ctx.actor?.userId ?? null,
        params: input.params,
        result: input.result,
        audit_id: input.auditId ?? null,
      },
    });
    return { channel: "webhook", status: "ok" };
  } catch (err) {
    const msg = errorMessage(err);
    console.error(
      `[side-effects] webhook failed for ${input.actionName}: ${msg}`,
    );
    return { channel: "webhook", status: "error", error: msg };
  }
}

// M2.4: persist each non-skipped, non-audit channel dispatch as its own
// child row in action_audit. Schema decision recorded in CHANGE TIER YAML +
// side-effects.test.ts: subject_type="side_effect", subject_id=channel name,
// metadata.parent_action_audit_id=<parent>. Reuses the existing audit store
// — no migration, no new table, queryable through the same reader.
//
// The audit_pre/audit_post middleware already wrote the parent row by the
// time dispatch fires; the `audit` channel therefore stays a documented
// no-op here. Skipped channels (no config, no email) are NOT persisted
// because they have no externally-observable side effect — recording every
// no-op would clog the audit timeline.
async function persistSideEffectAudit(
  input: DispatchSideEffectsInput,
  result: SideEffectResult,
): Promise<void> {
  if (!input.ctx.audit) return;
  if (result.channel === "audit") return;
  if (result.status === "skipped") return;
  const actor = input.ctx.actor;
  await input.ctx.audit.insertActionAudit({
    actor: actor?.userId ?? "<anonymous>",
    actor_role: actor?.role ?? "<anonymous>",
    via: "side_effect",
    subject_type: "side_effect",
    subject_id: result.channel,
    before: null,
    after: null,
    metadata: {
      action_type: input.actionName,
      status: result.status,
      ...(result.error ? { error: result.error } : {}),
      ...(result.detail ? { detail: result.detail } : {}),
      ...(input.auditId
        ? { parent_action_audit_id: input.auditId }
        : {}),
    },
  });
}

export async function dispatchSideEffects(
  input: DispatchSideEffectsInput,
): Promise<SideEffectResult[]> {
  const def = input.ontology.action_types[input.actionName];
  if (!def?.side_effects || def.side_effects.length === 0) return [];

  const perActionConfig = def.side_effects_config;
  const results: SideEffectResult[] = [];

  for (const channel of def.side_effects) {
    let result: SideEffectResult;
    switch (channel) {
      case "audit":
        result = {
          channel: "audit",
          status: "skipped",
          detail: "handled by US-030 audit middleware",
        };
        break;
      case "notify_member":
        result = await runNotifyMember(input);
        break;
      case "notify_steward":
        result = await runNotifySteward(input, perActionConfig);
        break;
      case "webhook":
        result = await runWebhook(input, perActionConfig);
        break;
      default: {
        const _exhaustive: never = channel;
        void _exhaustive;
        continue;
      }
    }
    results.push(result);
    // Persist after returning the per-channel result so an audit-write
    // failure does not poison the dispatcher contract — it's logged + the
    // rest of the channels still fan out.
    try {
      await persistSideEffectAudit(input, result);
    } catch (err) {
      console.error(
        `[side-effects] failed to persist audit row for ${channel} of ${input.actionName}: ${errorMessage(err)}`,
      );
    }
  }

  return results;
}

// === Env loader ===
//
// Production wiring reads SMTP / Resend / webhook URL from process.env;
// tests exercise this via a plain Record<string, string> fixture.

export function loadSideEffectConfigFromEnv(
  env: Record<string, string | undefined>,
): SideEffectsConfig {
  const cfg: SideEffectsConfig = {};
  const raw = env.STEWARD_EMAILS;
  if (raw) {
    const list = raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (list.length > 0) cfg.steward_emails = list;
  }
  if (env.SIDE_EFFECT_WEBHOOK_URL) {
    cfg.webhook_url = env.SIDE_EFFECT_WEBHOOK_URL;
  }
  return cfg;
}
