"use client";

import { useEffect, useState } from "react";

// Listens to the `acropolisos:chat-status` CustomEvent dispatched by
// chat-panel on every useChat status transition. Renders a thin shimmer
// bar at the very top of the viewport whenever the agent is working
// (status !== "ready"). Mounted once globally from app/layout.tsx so it
// overlays whichever home variant is on screen.
//
// Indeterminate animation by design — useChat doesn't expose step-level
// progress, and the spec's "step 2 of 3" indicator lives in the bottom
// strip's chat header where the actual phase text streams in.

export function TopProgressBar(): React.ReactElement | null {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const handler = (e: Event): void => {
      const detail = (e as CustomEvent<{ status?: string }>).detail;
      setActive(!!detail && detail.status !== "ready");
    };
    window.addEventListener("acropolisos:chat-status", handler);
    return () => window.removeEventListener("acropolisos:chat-status", handler);
  }, []);
  if (!active) return null;
  return (
    <div
      role="progressbar"
      aria-label="Agent working"
      data-testid="top-progress-bar"
      className="fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden bg-violet-500/10"
    >
      <div className="acro-shimmer-bar h-full w-1/3 bg-violet-400" />
      <style>{`
        @keyframes acro-shimmer-bar {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        .acro-shimmer-bar {
          animation: acro-shimmer-bar 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
        }
      `}</style>
    </div>
  );
}
