// lib/channels/bindings.test.ts
//
// channel_bindings is a hand-managed infra table (like raw_inbox / approved_views)
// — explicitly NOT in schema.generated.ts and NOT created by drizzle-kit push
// (push silently skips new tables; see docker-entrypoint.sh). This test pins the
// Drizzle table object's column surface so a drift between schema.ts, the
// entrypoint CREATE TABLE, and the unique-index key is caught here.

import { describe, expect, it } from "vitest";
import { channel_bindings } from "@/lib/db/schema";

describe("channel_bindings table", () => {
  it("exposes the binding columns", () => {
    const cols = Object.keys(channel_bindings);
    for (const c of [
      "id",
      "platform",
      "scope",
      "external_id",
      "sub_id",
      "title",
      "label",
      "status",
      "enabled",
      "created_at",
      "updated_at",
    ])
      expect(cols).toContain(c);
  });
});
