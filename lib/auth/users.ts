import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";

// M3.8: "anonymous" is the zero-permission sentinel role assigned by
// buildChatRuntime when auth() returns null. It is NEVER assigned via
// enrichSession (a real session always lands as "member" or "steward").
// Adding it to the union lets the type system surface call-sites that
// must gate on isAnonymous() before performing privileged work.
export type BuiltInRole = "member" | "steward" | "anonymous";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: BuiltInRole;
  customRoles: string[];
  createdAt: string;
}

export interface AuthorizedUser {
  id: string;
  email: string;
  role: BuiltInRole;
  customRoles: string[];
}

// bcryptjs cost factor. Production default 10 = ~100ms per hash. We lower it
// to 4 (~3ms) under vitest so the steward-route test suite — which hashes
// 4-5 passwords across its cases — comfortably stays under the 5s default
// test timeout. This eliminates the flake observed in negativa cycle 5 where
// the suite ran right at the timeout edge (4.7s) and intermittently failed.
// Set ACROPOLISOS_BCRYPT_COST to override either default.
const BCRYPT_COST = (() => {
  const override = Number(process.env.ACROPOLISOS_BCRYPT_COST);
  if (Number.isFinite(override) && override >= 4 && override <= 15) {
    return override;
  }
  return process.env.VITEST === "true" ? 4 : 10;
})();

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export interface UserStore {
  findByEmail(email: string): Promise<UserRecord | null>;
  create(input: {
    email: string;
    password: string;
    role: BuiltInRole;
    customRoles: string[];
  }): Promise<UserRecord>;
  // #40: deleteById used by claimInvite rollback — if the atomic Member.update
  // fails after user creation, we delete the orphaned user record.
  deleteById(id: string): Promise<boolean>;
  authorize(email: string, password: string): Promise<AuthorizedUser | null>;
  countStewards(): Promise<number>;
}

interface FileShape {
  users: UserRecord[];
}

export class FileUserStore implements UserStore {
  constructor(private readonly file: string) {}

  private async readAll(): Promise<UserRecord[]> {
    try {
      const raw = await readFile(this.file, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      return Array.isArray(parsed.users) ? parsed.users : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private async writeAll(users: UserRecord[]): Promise<void> {
    const dir = path.dirname(this.file);
    await mkdir(dir, { recursive: true });
    // #40: write to a temp file then atomically rename so a crash mid-write
    // cannot corrupt the canonical users.json.
    const tmp = path.join(dir, `.users-${randomUUID()}.tmp.json`);
    await writeFile(
      tmp,
      JSON.stringify({ users } satisfies FileShape, null, 2),
      "utf8",
    );
    await rename(tmp, this.file);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const needle = email.trim().toLowerCase();
    const users = await this.readAll();
    return users.find((u) => u.email === needle) ?? null;
  }

  async create(input: {
    email: string;
    password: string;
    role: BuiltInRole;
    customRoles: string[];
  }): Promise<UserRecord> {
    const email = input.email.trim().toLowerCase();
    const users = await this.readAll();
    if (users.some((u) => u.email === email)) {
      throw new Error(`user with email "${email}" already exists`);
    }
    const record: UserRecord = {
      id: randomUUID(),
      email,
      passwordHash: await hashPassword(input.password),
      role: input.role,
      customRoles: [...input.customRoles],
      createdAt: new Date().toISOString(),
    };
    users.push(record);
    await this.writeAll(users);
    return record;
  }

  async deleteById(id: string): Promise<boolean> {
    const users = await this.readAll();
    const idx = users.findIndex((u) => u.id === id);
    if (idx < 0) return false;
    users.splice(idx, 1);
    await this.writeAll(users);
    return true;
  }

  async authorize(
    email: string,
    password: string,
  ): Promise<AuthorizedUser | null> {
    const user = await this.findByEmail(email);
    if (!user) return null;
    if (!(await verifyPassword(password, user.passwordHash))) return null;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      customRoles: [...user.customRoles],
    };
  }

  async countStewards(): Promise<number> {
    const users = await this.readAll();
    return users.filter((u) => u.role === "steward").length;
  }
}
