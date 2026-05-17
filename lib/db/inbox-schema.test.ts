import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { inbox } from "./schema";

describe("inbox table", () => {
  it("is named inbox", () => {
    const config = getTableConfig(inbox);
    expect(config.name).toBe("inbox");
  });

  it("declares every column required by US-009", () => {
    const config = getTableConfig(inbox);
    const byName = Object.fromEntries(config.columns.map((c) => [c.name, c]));

    expect(byName.id).toBeDefined();
    expect(byName.id.primary).toBe(true);
    expect(byName.id.notNull).toBe(true);
    expect(byName.id.getSQLType()).toBe("uuid");

    expect(byName.at).toBeDefined();
    expect(byName.at.notNull).toBe(true);
    expect(byName.at.getSQLType()).toBe("timestamp with time zone");

    expect(byName.source_filename).toBeDefined();
    expect(byName.source_filename.notNull).toBe(true);
    expect(byName.source_filename.getSQLType()).toBe("text");

    expect(byName.mime_type).toBeDefined();
    expect(byName.mime_type.notNull).toBe(true);
    expect(byName.mime_type.getSQLType()).toBe("text");

    expect(byName.payload).toBeDefined();
    expect(byName.payload.notNull).toBe(true);
    expect(byName.payload.getSQLType()).toBe("jsonb");

    expect(byName.claimed_by_proposal_id).toBeDefined();
    expect(byName.claimed_by_proposal_id.notNull).toBe(false);
    expect(byName.claimed_by_proposal_id.getSQLType()).toBe("uuid");
  });
});
