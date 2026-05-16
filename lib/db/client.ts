import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

export type Database = ReturnType<typeof createDb>;

export function createDb(url: string = requireEnv("DATABASE_URL")) {
  const client = postgres(url, { max: 10 });
  const db = drizzle(client, { schema });
  return Object.assign(db, { $client: client });
}

let cached: Database | null = null;

export function getDb(): Database {
  if (!cached) cached = createDb();
  return cached;
}

export { schema };
