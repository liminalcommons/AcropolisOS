import { describe, expect, it } from "vitest";
import type { Actor } from "../ctx";
import { createInMemoryStore } from "./ctx";
import { createCtx, type ObjectPermissionsMap } from "./ctx";
describe("OntologyStore.objects is a hybrid map (platform typed + string index)", () => {
  it("resolves an arbitrary scenario type name via the string index", () => {
    const store = createInMemoryStore();
    const book = store.objects["Book"]; // compile error today (fixed-field interface)
    void book;
    expect(typeof store.objects.Member.findById).toBe("function");
  });
  it("createCtx permission-wraps every key; unmapped type fail-closes", async () => {
    const { PermissionError } = await import("./ctx");
    const db = createInMemoryStore();
    const actor: Actor = { userId: "u1", email: "a@x", role: "steward", customRoles: [] };
    const ctx = createCtx({ db, actor, permissions: {} as ObjectPermissionsMap }); // NO Member entry
    expect(await ctx.objects.Member.findById("x")).toBeNull();
    await expect(ctx.objects.Member.update("x", {} as never)).rejects.toBeInstanceOf(PermissionError);
  });
});
