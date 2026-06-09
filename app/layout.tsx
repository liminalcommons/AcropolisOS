import type { Metadata } from "next";
import "./globals.css";
import { ReloadToast } from "@/components/dev/reload-toast";
import { TopProgressBar } from "@/components/top-progress-bar";
import { MutationPulseMount } from "@/components/home/mutation-pulse-mount";
import { AppShell } from "@/components/shell/app-shell";
import { auth } from "@/lib/auth";
import { createCtx } from "@/lib/ctx";
import { resolveProviderConfig } from "@/lib/agent/mastra";

export const metadata: Metadata = {
  title: "acropolisOS",
  description: "Self-hostable AI-first ontology platform for small communities",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // AppShell (and the CoPilotDock inside it) needs the actor role/email to
  // decide which proposal-panel buttons to show and to personalise the nav.
  // Cast: NextAuth's stock Session type narrows email as `string | null`
  // whereas our AcropolisSession projects it as `string | undefined`.
  // createCtx tolerates both; this cast just satisfies the static checker.
  const session = (await auth()) as Parameters<typeof createCtx>[0];
  const { actor } = createCtx(session);

  // Expose the configured model name to the chat thinking-strip header.
  // resolveProviderConfig throws if LLM_API_KEY is missing — tolerate that
  // so the layout still renders during setup / unauth flows.
  let modelName: string | undefined;
  try {
    modelName = resolveProviderConfig().model;
  } catch {
    modelName = undefined;
  }

  // Map createCtx actor → AppShell's { userId, role, email } | null shape.
  // actor.userId and actor.role match exactly; actor is null when no session.
  const shellActor = actor
    ? { userId: actor.userId, role: actor.role, email: actor.email }
    : null;

  return (
    <html lang="en">
      <body className="antialiased">
        {/* Accessibility: skip link — sr-only until keyboard-focused, then jumps
            past the chrome to the main content region (#main-content lives on
            the content wrapper inside AppShell, both authed and unauth branches). */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:border focus:border-ring focus:bg-card focus:px-3 focus:py-2 focus:text-foreground"
        >
          Skip to content
        </a>
        <TopProgressBar />
        <AppShell actor={shellActor} modelName={modelName}>
          {children}
        </AppShell>
        <MutationPulseMount />
        <ReloadToast />
      </body>
    </html>
  );
}
