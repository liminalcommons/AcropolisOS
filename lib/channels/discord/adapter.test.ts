// lib/channels/discord/adapter.test.ts
//
// The discordAdapter implements ChannelAdapter for inbound Discord interactions
// (data-only). It mirrors telegramAdapter but for Discord's Interactions
// Endpoint shape.
//
// parsePayload: turns an APPLICATION_COMMAND (type 2) Interaction into ONE
//   raw_inbox row (command name, options, invoking user, guild/channel,
//   interaction_id). A PING (type 1) carries no data -> returns [] (the route
//   answers the PONG; PING is not captured). Other interaction types -> [].
//   A non-object / non-numeric-type body throws a SAFE error (no secret leak).
//
// verifyRequest: the ChannelAdapter contract is SYNCHRONOUS and reads only the
//   request (no raw body), but Discord's Ed25519 signature is over the RAW body.
//   So verifyRequest here verifies ONLY the verifiable subset it CAN see
//   synchronously (env public key present + both signature headers present) and
//   returns false otherwise. The SUBSTANTIVE Ed25519 check is the route's job
//   via verifyDiscordSignature (which has the raw body). This test pins that
//   behaviour so the method is not a dead masquerade for the real check.

import { describe, expect, it } from "vitest";
import { discordAdapter } from "@/lib/channels/discord/adapter";
import { SAMPLE_INTERACTION, SAMPLE_PING } from "@/lib/channels/discord/types";

const SIG_HEADER = "X-Signature-Ed25519";
const TS_HEADER = "X-Signature-Timestamp";

function reqWithHeaders(opts: { sig?: string | null; ts?: string | null }): Request {
  const headers = new Headers();
  if (opts.sig !== null && opts.sig !== undefined) headers.set(SIG_HEADER, opts.sig);
  if (opts.ts !== null && opts.ts !== undefined) headers.set(TS_HEADER, opts.ts);
  return new Request("http://localhost/api/channels/discord", { method: "POST", headers });
}

describe("discordAdapter.source", () => {
  it("is 'discord'", () => {
    expect(discordAdapter.source).toBe("discord");
  });
});

describe("discordAdapter.parsePayload", () => {
  it("extracts command, options, user, and identity from a type=2 interaction", async () => {
    const rows = await discordAdapter.parsePayload(SAMPLE_INTERACTION);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      command: SAMPLE_INTERACTION.data!.name,
      user_id: SAMPLE_INTERACTION.member!.user.id,
      guild_id: SAMPLE_INTERACTION.guild_id,
      channel_id: SAMPLE_INTERACTION.channel_id,
      interaction_id: SAMPLE_INTERACTION.id,
      type: 2,
    });
    expect(rows[0].options).toEqual(SAMPLE_INTERACTION.data!.options);
  });

  it("reads the invoking user from top-level `user` (DM interaction) when member is absent", async () => {
    const rows = await discordAdapter.parsePayload({
      type: 2,
      id: "i1",
      application_id: "a1",
      token: "t1",
      user: { id: "dm-user-1", username: "solo" },
      data: { id: "c1", name: "note", options: [{ name: "body", value: "hi" }] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe("dm-user-1");
    expect(rows[0].username).toBe("solo");
    // guild interactions only — guild_id/channel_id absent -> null, not a throw
    expect(rows[0].guild_id).toBeNull();
  });

  it("returns [] for a PING (type 1) — PING is not data", async () => {
    const rows = await discordAdapter.parsePayload(SAMPLE_PING);
    expect(rows).toEqual([]);
  });

  it("returns [] for an unmodeled interaction type (e.g. message component, type 3)", async () => {
    const rows = await discordAdapter.parsePayload({
      type: 3,
      id: "i2",
      application_id: "a1",
      token: "t1",
    });
    expect(rows).toEqual([]);
  });

  it("captures a command with no options as an empty options array", async () => {
    const rows = await discordAdapter.parsePayload({
      type: 2,
      id: "i3",
      application_id: "a1",
      token: "t1",
      member: { user: { id: "u3", username: "x" } },
      data: { id: "c3", name: "ping-cmd" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].command).toBe("ping-cmd");
    expect(rows[0].options).toEqual([]);
  });

  it("throws a SAFE error (no secret) for a non-object body", async () => {
    await expect(discordAdapter.parsePayload("not an object")).rejects.toThrow(
      /invalid discord interaction/i,
    );
    await expect(discordAdapter.parsePayload(null)).rejects.toThrow(/invalid discord interaction/i);
    await expect(discordAdapter.parsePayload([1, 2, 3])).rejects.toThrow(
      /invalid discord interaction/i,
    );
  });

  it("throws a SAFE error when `type` is missing/non-numeric", async () => {
    await expect(discordAdapter.parsePayload({ id: "i", token: "t" })).rejects.toThrow(
      /invalid discord interaction/i,
    );
    await expect(discordAdapter.parsePayload({ type: "2" })).rejects.toThrow(
      /invalid discord interaction/i,
    );
  });
});

describe("discordAdapter.verifyRequest (verifiable-subset only)", () => {
  it("returns false (inert) when the env public key is unset", () => {
    expect(discordAdapter.verifyRequest(reqWithHeaders({ sig: "ab", ts: "1" }), undefined)).toBe(false);
    expect(discordAdapter.verifyRequest(reqWithHeaders({ sig: "ab", ts: "1" }), "")).toBe(false);
  });

  it("returns false when the signature header is missing", () => {
    expect(discordAdapter.verifyRequest(reqWithHeaders({ sig: null, ts: "1" }), "pubkey")).toBe(false);
  });

  it("returns false when the timestamp header is missing", () => {
    expect(discordAdapter.verifyRequest(reqWithHeaders({ sig: "ab", ts: null }), "pubkey")).toBe(false);
  });

  it("returns true only for the verifiable subset (env + both headers present) — the route does the real Ed25519 check", () => {
    expect(discordAdapter.verifyRequest(reqWithHeaders({ sig: "ab", ts: "1" }), "pubkey")).toBe(true);
  });
});
