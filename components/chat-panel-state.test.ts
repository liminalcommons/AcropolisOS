import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_PANEL_STORAGE_KEY,
  DEFAULT_PANEL_STATE,
  loadPanelState,
  savePanelState,
  subscribePanelState,
} from "./chat-panel-state";

interface MemoryStorage {
  store: Map<string, string>;
}

function createMemoryStorage(): Storage & MemoryStorage {
  const store = new Map<string, string>();
  return {
    store,
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => {
      store.delete(k);
    },
    setItem: (k, v) => {
      store.set(k, v);
    },
  };
}

describe("chat-panel-state", () => {
  const original = globalThis as { localStorage?: Storage };
  let mem: ReturnType<typeof createMemoryStorage>;

  beforeEach(() => {
    mem = createMemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: mem,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    delete original.localStorage;
    vi.restoreAllMocks();
  });

  it("returns DEFAULT_PANEL_STATE when storage is empty", () => {
    expect(loadPanelState()).toEqual(DEFAULT_PANEL_STATE);
  });

  it("round-trips an open=true state via save then load", () => {
    savePanelState({ open: true });
    expect(loadPanelState()).toEqual({ open: true });
  });

  it("round-trips an open=false state via save then load", () => {
    savePanelState({ open: false });
    expect(loadPanelState()).toEqual({ open: false });
  });

  it("ignores malformed stored JSON and returns DEFAULT_PANEL_STATE", () => {
    mem.setItem(CHAT_PANEL_STORAGE_KEY, "not-json");
    expect(loadPanelState()).toEqual(DEFAULT_PANEL_STATE);
  });

  it("ignores stored values with wrong shape and returns DEFAULT_PANEL_STATE", () => {
    mem.setItem(CHAT_PANEL_STORAGE_KEY, JSON.stringify({ foo: "bar" }));
    expect(loadPanelState()).toEqual(DEFAULT_PANEL_STATE);
  });

  it("returns DEFAULT_PANEL_STATE when localStorage is undefined (SSR)", () => {
    delete original.localStorage;
    expect(loadPanelState()).toEqual(DEFAULT_PANEL_STATE);
  });

  it("is a no-op when saving without localStorage (SSR)", () => {
    delete original.localStorage;
    expect(() => savePanelState({ open: true })).not.toThrow();
  });

  it("notifies subscribers after save", () => {
    const fn = vi.fn();
    const unsub = subscribePanelState(fn);
    savePanelState({ open: true });
    savePanelState({ open: false });
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
    savePanelState({ open: true });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("swallows quota / storage errors silently", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        ...mem,
        setItem: () => {
          throw new Error("quota");
        },
      },
      configurable: true,
      writable: true,
    });
    expect(() => savePanelState({ open: true })).not.toThrow();
  });
});
