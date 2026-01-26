import type { Metadata } from "next";
import "./globals.css";
import "@/styles/beacon-map.css";
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
