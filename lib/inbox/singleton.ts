import { getDb } from "../db/client";
import { InMemoryInboxStore, PgInboxStore, type InboxStore } from "./store";

let instance: InboxStore | null = null;

export function getInboxStore(): InboxStore {
  if (!instance) {
    // Importing db/client is side-effect-free — getDb() only opens a connection
    // when called, and that call is still gated on DATABASE_URL. The previous
    // lazy require() broke under vitest (it could not resolve the relative path
    // from the transformed module), failing every test that hit this path.
    instance = process.env.DATABASE_URL
      ? new PgInboxStore(getDb())
      : new InMemoryInboxStore();
  }
  return instance;
}

export function __resetInboxStoreForTests(): void {
  instance = null;
}
