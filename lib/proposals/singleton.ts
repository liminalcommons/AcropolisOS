import { InMemoryProposalDraftStore, type ProposalDraftStore } from "./store";
import { PgProposalDraftStore } from "./store-pg";
import { getDb } from "../db/client";

let instance: ProposalDraftStore | null = null;

function buildStore(): ProposalDraftStore {
  // Prefer the DB-backed store whenever DATABASE_URL is configured. Tests
  // call __resetProposalStoreForTests() between cases and run in an env
  // where DATABASE_URL is absent — that path stays on the in-memory impl.
  if (!process.env.DATABASE_URL) {
    return new InMemoryProposalDraftStore();
  }
  try {
    return new PgProposalDraftStore(getDb());
  } catch {
    return new InMemoryProposalDraftStore();
  }
}

export function getProposalStore(): ProposalDraftStore {
  if (!instance) instance = buildStore();
  return instance;
}

export function __resetProposalStoreForTests(): void {
  instance = null;
}
