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

export async function dispatchSideEffects(
  input: DispatchSideEffectsInput,
): Promise<SideEffectResult[]> {
  const def = input.ontology.action_types[input.actionName];
  if (!def?.side_effects || def.side_effects.length === 0) return [];

  const perActionConfig = def.side_effects_config;
  const results: SideEffectResult[] = [];

  for (const channel of def.side_effects) {
    switch (channel) {
      case "audit":
        results.push({
          channel: "audit",
          status: "skipped",
          detail: "handled by US-030 audit middleware",
        });
        break;
      case "notify_member":
        results.push(await runNotifyMember(input));
        break;
      case "notify_steward":
        results.push(await runNotifySteward(input, perActionConfig));
        break;
      case "webhook":
        results.push(await runWebhook(input, perActionConfig));
        break;
      default: {
        const _exhaustive: never = channel;
        void _exhaustive;
      }
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
