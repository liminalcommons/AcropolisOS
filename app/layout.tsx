import type { Metadata } from "next";
import "./globals.css";
import { ChatPanel } from "@/components/chat-panel";
import { ReloadToast } from "@/components/dev/reload-toast";
import { MutationPulseMount } from "@/components/home/mutation-pulse-mount";
import { auth } from "@/lib/auth";
import { createCtx } from "@/lib/ctx";

export const metadata: Metadata = {
  title: "acropolisOS",
  description: "Self-hostable AI-first ontology platform for small communities",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // ChatPanel needs the actor role to decide which proposal-panel buttons to
  // show (steward → Apply/Edit/Reject, member → Submit for review). The chat
  // panel is a client component so we resolve the session server-side here and
  // pass it down as plain props.
  // Cast: NextAuth's stock Session type narrows email as `string | null`
  // whereas our AcropolisSession projects it as `string | undefined`.
  // createCtx tolerates both; this cast just satisfies the static checker.
  const session = (await auth()) as Parameters<typeof createCtx>[0];
  const { actor } = createCtx(session);

  return (
    <html lang="en">
      <body className="pb-11 antialiased">
        {children}
        <ChatPanel
          actorRole={actor?.role ?? null}
          actorEmail={actor?.email}
        />
        <MutationPulseMount />
        <ReloadToast />
      </body>
    </html>
  );
}
