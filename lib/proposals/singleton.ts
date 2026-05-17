import { InMemoryProposalDraftStore, type ProposalDraftStore } from "./store";

let instance: ProposalDraftStore | null = null;

export function getProposalStore(): ProposalDraftStore {
  if (!instance) instance = new InMemoryProposalDraftStore();
  return instance;
}

export function __resetProposalStoreForTests(): void {
  instance = null;
}
