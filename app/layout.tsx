import type { Metadata } from "next";
import "./globals.css";

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
      <body className="antialiased">{children}</body>
    </html>
  );
}
