// US-022: Reload toast display formatting.
//
// Pure mapping from ReloadEvent.kind to the user-visible toast string.
// Lives alongside the bus so the SSE consumer doesn't have to duplicate
// the message taxonomy.

import type { ReloadEvent } from "./reload-bus";

export function formatReloadToast(event: ReloadEvent): string {
  switch (event.kind) {
    case "ontology":
      return "Reloading ontology…";
    case "view":
      return "Reloading views…";
    default:
      return "Reloading…";
  }
}
