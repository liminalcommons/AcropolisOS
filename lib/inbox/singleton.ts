import { InMemoryInboxStore, type InboxStore } from "./store";

let instance: InboxStore | null = null;

export function getInboxStore(): InboxStore {
  if (!instance) instance = new InMemoryInboxStore();
  return instance;
}

export function __resetInboxStoreForTests(): void {
  instance = null;
}
