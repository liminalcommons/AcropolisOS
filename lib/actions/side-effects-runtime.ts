// US-028: production wiring for side-effect adapters.
//
// The dispatcher in side-effects.ts is transport-agnostic; this module
// chooses concrete implementations based on environment:
//   - RESEND_API_KEY set  → POST to api.resend.com
//   - SMTP_HOST set       → log + no-op (real SMTP integration deferred)
//   - neither             → log-only sendMail (development default)
//
// Webhook posts use the platform fetch (no extra dependency).
// Failures from these adapters propagate to the dispatcher, which captures
// them per-channel without affecting the action's audit envelope.

import type {
  PostWebhook,
  SendMail,
  SideEffectAdapters,
} from "./side-effects";
import type { SideEffectsConfig } from "../ontology/schema";

function makeResendMailer(apiKey: string, from: string): SendMail {
  return async ({ to, subject, body }) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, text: body }),
    });
    if (!res.ok) {
      throw new Error(
        `resend send to ${to} failed: ${res.status} ${res.statusText}`,
      );
    }
  };
}

function makeLogMailer(): SendMail {
  return async ({ to, subject }) => {
    console.log(`[side-effects:mail] (no provider) to=${to} subject=${subject}`);
  };
}

function makeFetchWebhookPoster(): PostWebhook {
  return async ({ url, body }) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `webhook POST ${url} failed: ${res.status} ${res.statusText}`,
      );
    }
    return { status: res.status };
  };
}

export function resolveSideEffectAdapters(
  config: SideEffectsConfig,
): SideEffectAdapters {
  const env = process.env;
  const resendKey = env.RESEND_API_KEY;
  const mailFrom = env.SIDE_EFFECT_MAIL_FROM ?? "noreply@acropolisos.local";

  const sendMail: SendMail = resendKey
    ? makeResendMailer(resendKey, mailFrom)
    : makeLogMailer();

  return {
    sendMail,
    postWebhook: makeFetchWebhookPoster(),
    config,
  };
}
