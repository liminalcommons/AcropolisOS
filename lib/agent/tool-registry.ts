// US-022: Default Mastra tool registry — singleton facade over the live
// generated tools, reload-aware in dev.
//
// Callers reach for `getDefaultMastraTools()` instead of importing from
// tools.generated.ts directly. The registry caches the tool map and
// invalidates whenever the dev reload bus publishes — so after the
// watcher regenerates the ontology, the next read sees the new tool
// shapes without a Next restart.
//
// In production the reload bus is never published to, so the cache stays
// warm forever — no per-request rebuild cost.

import { createToolRegistry, type ToolRegistry } from "../dev/tool-registry";
import { getDefaultReloadBus } from "../dev/reload-bus";
import { tools as generatedTools } from "./tools.generated";

type MastraTools = typeof generatedTools;

// Held on globalThis so HMR-induced module reloads do not lose the registry
// (and its bus subscription) mid-session.
const GLOBAL_KEY = "__acropolisos_mastra_tool_registry__";
type GlobalSlot = { [GLOBAL_KEY]?: ToolRegistry<MastraTools> };

function ensureRegistry(): ToolRegistry<MastraTools> {
  const slot = globalThis as unknown as GlobalSlot;
  if (!slot[GLOBAL_KEY]) {
    const reg = createToolRegistry<MastraTools>(() => generatedTools);
    reg.attachReloadBus(getDefaultReloadBus());
    slot[GLOBAL_KEY] = reg;
  }
  return slot[GLOBAL_KEY];
}

export function getDefaultMastraTools(): MastraTools {
  return ensureRegistry().get();
}

export function invalidateDefaultMastraTools(): void {
  ensureRegistry().invalidate();
}
