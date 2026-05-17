import type { Metadata } from "next";
import "./globals.css";
import { ChatPanel } from "@/components/chat-panel";
import { ReloadToast } from "@/components/dev/reload-toast";

export const metadata: Metadata = {
  title: "acropolisOS",
  description: "Self-hostable AI-first ontology platform for small communities",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <ChatPanel />
        <ReloadToast />
      </body>
    </html>
  );
}
