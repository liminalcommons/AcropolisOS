// lib/channels/adapter.ts
//
// ChannelAdapter — the inbound-channel abstraction.
//
// An adapter turns a platform's webhook (Telegram now; Discord/WhatsApp/Matrix
// later) into DATA-ONLY rows for the shared raw_inbox intake path. It captures
// exactly two platform-specific responsibilities and nothing more:
//
//   1. verifyRequest — authenticate the inbound request against an env secret
//      (constant-time), so an unauthenticated public endpoint cannot be abused.
//   2. parsePayload  — map the platform payload into raw_inbox-ready rows.
//
// SCOPE FENCE (inbound-only): an adapter MUST NOT read the ontology fence
// (lib/ontology/ctx.ts), perform authenticated reads, call agent tools/actions,
// or map a platform user to an acropolisOS actor. It returns data; downstream
// classification (a later slice) does the rest.

export interface ChannelAdapter {
  /**
   * The source name stamped into raw_inbox.source (e.g. "telegram").
   * Lowercase alphanumeric + underscore identifier.
   */
  readonly source: string;

  /**
   * Verify the inbound request is authentic from the platform.
   *
   * - MUST use constant-time comparison for the secret.
   * - Returns false (never throws) when the env secret is unset or the
   *   request's secret is missing/mismatched.
   * - MUST NOT log the secret or reveal it in errors.
   *
   * @param req       the inbound HTTP request
   * @param envSecret the expected secret from env (undefined when unset)
   */
  verifyRequest(req: Request, envSecret: string | undefined): boolean;

  /**
   * Parse a platform payload into raw_inbox-compatible rows.
   *
   * Each returned object becomes one raw_inbox.payload (source = this.source).
   * Returns an empty array for payloads that carry no message (not an error).
   * Throws an Error with a SAFE message (no secret/token leaks) on a malformed
   * payload.
   *
   * @param body the parsed request body (platform-specific shape)
   */
  parsePayload(body: unknown): Promise<Record<string, unknown>[]>;
}
