import type { Metadata } from "next";
import "./globals.css";
import "@/styles/map.css";
import { AppShell } from "@/components/AppShell";
import { TippyChat } from "@/components/TippyChat";

export const metadata: Metadata = {
  title: {
    default: "Beacon",
    template: "%s | Beacon",
  },
  description: "A guiding light for humane cat population management — data-driven TNR tracking, predictive modeling, and colony insights.",
  icons: {
    // Uses the existing org logo as favicon. Modern browsers accept PNG.
    // For white-label deployments, replace /logo.png in public/ with the
    // org's preferred icon — no code change needed.
    icon: [
      { url: "/logo.png", sizes: "any", type: "image/png" },
    ],
    apple: [
      { url: "/logo.png", sizes: "180x180", type: "image/png" },
    ],
    shortcut: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Suppress Google Maps auth failure dialog — must run before Google's script loads */}
        <script dangerouslySetInnerHTML={{ __html: 'window.gm_authFailure=function(){};' }} />
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="manifest" href="/manifest.json" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=Raleway:wght@400;500;600;700&family=Merriweather:wght@400;700;900&display=swap" rel="stylesheet" />
      </head>
      <body>
        {/* Auth is now handled by middleware + /login page */}
        <AppShell>{children}</AppShell>
        <TippyChat />
      </body>
    </html>
  );
}
