// US-022: Tool registry — cached factory with reload invalidation.
//
// The chat route (and anything else that holds Mastra tools) reads through
// this registry instead of importing tools.generated.ts directly. That way
// when the dev watcher regenerates the ontology, the next .get() call
// rebuilds tools against the fresh ontology — no Next restart, no stale
// closures, no per-call rebuild cost in steady state.
//
// Production: registry still caches; without a reload bus attached it just
// stays warm forever, which is what production wants anyway.

import type { ReloadBus } from "./reload-bus";

export interface ToolRegistry<T> {
  get(): T;
  invalidate(): void;
  attachReloadBus(bus: ReloadBus): () => void;
}

export function createToolRegistry<T>(build: () => T): ToolRegistry<T> {
  let cached: { value: T } | null = null;
  return {
    get() {
      if (!cached) cached = { value: build() };
      return cached.value;
    },
    invalidate() {
      cached = null;
    },
    attachReloadBus(bus) {
      return bus.subscribe(() => {
        cached = null;
      });
    },
  };
}
