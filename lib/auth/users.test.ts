import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileUserStore,
  hashPassword,
  verifyPassword,
  type UserRecord,
} from "./users";

let dir: string;
let store: FileUserStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "acrop-users-"));
  store = new FileUserStore(path.join(dir, "users.json"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("password hashing", () => {
  it("roundtrips a password through hash + verify", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).not.toEqual("correct horse battery staple");
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("FileUserStore", () => {
  it("returns null for unknown email", async () => {
    expect(await store.findByEmail("nobody@example.com")).toBeNull();
  });

  it("creates a user and finds it by email (lowercased)", async () => {
    const created = await store.create({
      email: "Alice@Example.COM",
      password: "hunter2",
      role: "steward",
      customRoles: [],
    });
    expect(created.email).toBe("alice@example.com");
    expect(created.role).toBe("steward");
    const found = await store.findByEmail("alice@example.com");
    expect(found?.id).toBe(created.id);
    expect(found?.email).toBe("alice@example.com");
  });

  it("rejects duplicate email on create", async () => {
    await store.create({
      email: "a@b.com",
      password: "x",
      role: "member",
      customRoles: [],
    });
    await expect(
      store.create({
        email: "a@b.com",
        password: "y",
        role: "member",
        customRoles: [],
      }),
    ).rejects.toThrow(/exists/i);
  });

  it("authorize() returns the user record on correct password, null otherwise", async () => {
    const created: UserRecord = await store.create({
      email: "s@example.com",
      password: "secret",
      role: "steward",
      customRoles: ["finance"],
    });
    const ok = await store.authorize("s@example.com", "secret");
    expect(ok?.id).toBe(created.id);
    expect(ok?.role).toBe("steward");
    expect(ok?.customRoles).toEqual(["finance"]);
    expect(await store.authorize("s@example.com", "wrong")).toBeNull();
    expect(await store.authorize("missing@example.com", "secret")).toBeNull();
  });

  it("counts stewards", async () => {
    expect(await store.countStewards()).toBe(0);
    await store.create({
      email: "m@example.com",
      password: "x",
      role: "member",
      customRoles: [],
    });
    expect(await store.countStewards()).toBe(0);
    await store.create({
      email: "s@example.com",
      password: "x",
      role: "steward",
      customRoles: [],
    });
    expect(await store.countStewards()).toBe(1);
  });
});
