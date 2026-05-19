// M2.4 step-2: structured-JSON stdout notify adapter.
//
// The default sink for notify_member in environments without RESEND_API_KEY.
// Each send writes ONE line of JSON to stdout so process collectors (Docker
// logs, journald, Vercel functions logger) ingest it as a structured event.
//
// Replaces the free-form `makeLogMailer` in side-effects-runtime.ts. Free-form
// text was unparseable downstream and gave no integration surface beyond
// eyeballing the container log.

import type { SendMail } from "./side-effects";

export function makeStdoutMailer(): SendMail {
  return async ({ to, subject, body, action_type }) => {
    const line = JSON.stringify({
      event: "notify_member",
      recipient: to,
      subject,
      body,
      ...(action_type ? { action_type } : {}),
      at: new Date().toISOString(),
    });
    console.log(line);
  };
}
