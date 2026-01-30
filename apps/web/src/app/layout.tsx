import type { Metadata } from "next";
import "./globals.css";
import "@/styles/atlas-map.css";
import { AppShell } from "@/components/AppShell";
import { TippyChat } from "@/components/TippyChat";

export const metadata: Metadata = {
  title: "Atlas",
  description: "Cat tracking and FFR management system",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Raleway:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {/* Auth is now handled by middleware + /login page */}
        <AppShell>{children}</AppShell>
        <TippyChat />
      </body>
    </html>
  );
}
