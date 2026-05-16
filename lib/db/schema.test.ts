import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import { _meta } from "./schema";

describe("db schema", () => {
  it("exposes the _meta table with the expected name", () => {
    const config = getTableConfig(_meta);
    expect(config.name).toBe("_meta");
  });

  it("declares key (pk, text) and value (jsonb) columns", () => {
    const config = getTableConfig(_meta);
    const byName = Object.fromEntries(config.columns.map((c) => [c.name, c]));

    expect(byName.key).toBeDefined();
    expect(byName.key.primary).toBe(true);
    expect(byName.key.notNull).toBe(true);
    expect(byName.key.getSQLType()).toBe("text");

    expect(byName.value).toBeDefined();
    expect(byName.value.getSQLType()).toBe("jsonb");

    expect(byName.updated_at).toBeDefined();
    expect(byName.updated_at.notNull).toBe(true);
  });
});
