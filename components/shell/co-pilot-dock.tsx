"use client";

import { useEffect, useState } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { ChatPanel } from "@/components/chat-panel";
import { DOCK_KEY, readCollapsed, writeCollapsed } from "./shell-state";
import { DOCK_TOGGLE_COLLAPSED_CLS, DOCK_TOGGLE_EXPANDED_CLS } from "./dock-affordance";
import type { BuiltInRole } from "@/lib/auth/users";

interface Props {
  actorRole: BuiltInRole | null;
  actorEmail?: string;
  modelName?: string;
}

export function CoPilotDock({ actorRole, actorEmail, modelName }: Props): React.ReactNode {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => setCollapsed(readCollapsed(DOCK_KEY)), []);

  // Programmatic open: the "Discuss with the agent" affordance (and any future
  // deep-link into the chat) fires acropolisos:open-chat so a collapsed dock
  // expands before the acropolisos:prompt seed lands on the (re-mounted) panel.
  useEffect(() => {
    const open = (): void => {
      setCollapsed(false);
      writeCollapsed(DOCK_KEY, false);
    };
    window.addEventListener("acropolisos:open-chat", open);
    return () => window.removeEventListener("acropolisos:open-chat", open);
  }, []);

  const toggle = (): void => {
    setCollapsed((c) => {
      const next = !c;
      writeCollapsed(DOCK_KEY, next);
      return next;
    });
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label="Open co-pilot"
        className={DOCK_TOGGLE_COLLAPSED_CLS}
      >
        <PanelRightOpen className="h-4 w-4" aria-hidden />
      </button>
    );
  }

  return (
    <div className="relative flex h-full w-[340px] shrink-0 flex-col">
      <button
        type="button"
        onClick={toggle}
        aria-label="Collapse co-pilot"
        className={DOCK_TOGGLE_EXPANDED_CLS}
      >
        <PanelRightClose className="h-4 w-4" aria-hidden />
      </button>
      <ChatPanel actorRole={actorRole} actorEmail={actorEmail} modelName={modelName} />
    </div>
  );
}
