// F6: /dashboard/ask — chat with the agent to add a widget to the dashboard.
//
// Auth-gated (any authenticated member — mirrors /me). Server component shell
// wrapping a client form that submits to /api/chat and parses widget proposals.
//
// Flow:
//   1. User types a request ("show me which beds need cleaning tomorrow").
//   2. Form POSTs to /api/chat (existing route, same LLM runtime).
//   3. Agent response is displayed.
//   4. If the response contains a JSON code fence with { kind, title, props },
//      a PinnedWidget preview + "Pin to dashboard" button are shown.
//   5. Clicking "Pin" calls the pinWidget() server action → redirects to /.

import { redirect } from "next/navigation";
import { buildChatRuntime, isAnonymous } from "@/lib/agent/chat-runtime";
import { AskAgentChat } from "./chat-client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AskAgentPage(): Promise<React.ReactElement> {
  const chatRuntime = await buildChatRuntime();
  if (isAnonymous(chatRuntime.actor)) {
    redirect("/signin");
  }

  return (
    <main className="font-sans">
      <div className="mx-auto max-w-2xl px-6 py-10 flex flex-col" style={{ minHeight: "100vh" }}>

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-1">
            <a
              href="/"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              ← dashboard
            </a>
          </div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground">
            Ask the agent
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Describe the information you want to pin as a widget. The agent will propose one you can add to your dashboard.
          </p>
        </div>

        {/* Chat surface */}
        <AskAgentChat />

      </div>
    </main>
  );
}
