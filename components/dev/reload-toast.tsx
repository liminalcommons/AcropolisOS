"use client";

// US-022: Dev-only "Reloading…" toast.
//
// Mounts a small fixed-position toast in dev that subscribes to the SSE
// stream at /api/dev/reload. When the dev-watch script finishes a codegen
// pass and POSTs to the same endpoint, the bus fans the event out here
// and we flash the toast for ~1.5s. The Next HMR runtime takes care of
// swapping the regenerated modules independently — the toast is the
// "felt" surface so the smoke loop has something visible to assert.
//
// Renders nothing when NODE_ENV !== "development".

import { useEffect, useState } from "react";
import {
  formatReloadToast,
} from "@/lib/dev/toast-message";
import type { ReloadEvent } from "@/lib/dev/reload-bus";

const TOAST_VISIBLE_MS = 1500;

function isReloadEvent(value: unknown): value is ReloadEvent {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    (obj.kind === "ontology" || obj.kind === "view" || obj.kind === "all") &&
    Array.isArray(obj.paths)
  );
}

export function ReloadToast(): React.ReactNode {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }
    const es = new EventSource("/api/dev/reload");
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    es.addEventListener("reload", (raw) => {
      try {
        const data = JSON.parse((raw as MessageEvent).data);
        if (!isReloadEvent(data)) return;
        setMessage(formatReloadToast(data));
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => setMessage(null), TOAST_VISIBLE_MS);
      } catch {
        /* malformed frame — ignore */
      }
    });
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      es.close();
    };
  }, []);

  if (process.env.NODE_ENV !== "development") return null;
  if (!message) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        bottom: 16,
        right: 16,
        zIndex: 9999,
        padding: "8px 14px",
        background: "rgba(17, 24, 39, 0.92)",
        color: "white",
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        borderRadius: 6,
        boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
        pointerEvents: "none",
      }}
    >
      {message}
    </div>
  );
}
