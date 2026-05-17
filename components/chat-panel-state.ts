export interface ChatPanelState {
  open: boolean;
}

export const CHAT_PANEL_STORAGE_KEY = "acropolisos.chat-panel.v1";

export const DEFAULT_PANEL_STATE: ChatPanelState = { open: false };

function isPanelState(value: unknown): value is ChatPanelState {
  if (!value || typeof value !== "object") return false;
  return typeof (value as { open?: unknown }).open === "boolean";
}

function getStorage(): Storage | null {
  if (typeof globalThis === "undefined") return null;
  const storage = (globalThis as { localStorage?: Storage }).localStorage;
  return storage ?? null;
}

export function loadPanelState(): ChatPanelState {
  const storage = getStorage();
  if (!storage) return DEFAULT_PANEL_STATE;
  let raw: string | null;
  try {
    raw = storage.getItem(CHAT_PANEL_STORAGE_KEY);
  } catch {
    return DEFAULT_PANEL_STATE;
  }
  if (!raw) return DEFAULT_PANEL_STATE;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPanelState(parsed) ? parsed : DEFAULT_PANEL_STATE;
  } catch {
    return DEFAULT_PANEL_STATE;
  }
}

const listeners = new Set<() => void>();

export function subscribePanelState(callback: () => void): () => void {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
}

export function savePanelState(state: ChatPanelState): void {
  const storage = getStorage();
  if (storage) {
    try {
      storage.setItem(CHAT_PANEL_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Quota / private-browsing — silently drop, panel will fall back to default next load.
    }
  }
  listeners.forEach((l) => l());
}
