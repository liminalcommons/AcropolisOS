// US-022: Reload bus — in-process pub/sub the hot-reload pipeline rides on.
//
// The dev watcher publishes when codegen finishes; the SSE route subscribes
// to fan events out to the browser; the Mastra tool registry subscribes to
// invalidate its cache. The bus is dev-only and lives in the same Node
// process as Next; HMR re-evaluates this module on edits, so we hold the
// singleton on globalThis to survive module reloads.

export type ReloadKind = "ontology" | "view" | "all";

export interface ReloadEvent {
  kind: ReloadKind;
  at: number;
  paths: string[];
}

export type ReloadListener = (event: ReloadEvent) => void;

export interface ReloadBus {
  subscribe(listener: ReloadListener): () => void;
  publish(event: ReloadEvent): void;
}

export function createReloadBus(): ReloadBus {
  const listeners = new Set<ReloadListener>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(event) {
      for (const listener of [...listeners]) {
        try {
          listener(event);
        } catch (err) {
          console.error("[reload-bus] listener threw", err);
        }
      }
    },
  };
}

const GLOBAL_KEY = "__acropolisos_reload_bus__";
type GlobalSlot = { [GLOBAL_KEY]?: ReloadBus };

export function getDefaultReloadBus(): ReloadBus {
  const slot = globalThis as unknown as GlobalSlot;
  if (!slot[GLOBAL_KEY]) {
    slot[GLOBAL_KEY] = createReloadBus();
  }
  return slot[GLOBAL_KEY];
}
