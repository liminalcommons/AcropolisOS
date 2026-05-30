import { describe, expect, it } from "vitest";
import { TABLES } from "../db/schema.generated";
import { createPgOntologyStore } from "./pg-store";
import { buildStubDb } from "./__test-helpers/stub-db";
import { createInMemoryStore } from "./ctx";
describe("pg-store builds objects dynamically from TABLES", () => {
  it("exposes EXACTLY the TABLES keys", () => {
    const { db } = buildStubDb({});
    const store = createPgOntologyStore(db);
    expect(Object.keys(store.objects).sort()).toEqual(Object.keys(TABLES).sort());
  });
  it("every accessor exposes full CRUD", () => {
    const { db } = buildStubDb({});
    const store = createPgOntologyStore(db);
    for (const name of Object.keys(TABLES))
      for (const m of ["findById", "findMany", "create", "update", "delete"] as const)
        expect(typeof (store.objects[name] as unknown as Record<string, unknown>)[m]).toBe("function");
  });
  it("in-memory store mirrors the TABLES key set by default", () => {
    expect(Object.keys(createInMemoryStore().objects).sort()).toEqual(Object.keys(TABLES).sort());
  });
});
