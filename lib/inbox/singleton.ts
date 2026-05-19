import { InMemoryInboxStore, PgInboxStore, type InboxStore } from "./store";

let instance: InboxStore | null = null;

export function getInboxStore(): InboxStore {
  if (!instance) {
    if (process.env.DATABASE_URL) {
      // Lazy-import the DB client so the module graph is not broken in test
      // environments where DATABASE_URL is unset and getDb() would throw.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getDb } = require("../db/client") as { getDb: () => import("../db/client").Database };
      instance = new PgInboxStore(getDb());
    } else {
      instance = new InMemoryInboxStore();
    }
  }
  return instance;
}

export function __resetInboxStoreForTests(): void {
  instance = null;
}
