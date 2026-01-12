import type { Metadata } from "next";
import "./globals.css";
import GlobalSearch from "@/components/GlobalSearch";

export const metadata: Metadata = {
  title: "Atlas",
  description: "Cat tracking and TNR management system",
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
        <nav className="nav">
          <div className="container nav-inner">
            <a href="/" className="nav-brand">
              <img src="/logo.png" alt="Atlas" className="nav-logo" />
              <span>Atlas</span>
            </a>
            <GlobalSearch />
            <div className="nav-links">
              <a href="/requests" className="nav-link">
                Requests
              </a>
              <a href="/cats" className="nav-link">
                Cats
              </a>
              <a href="/people" className="nav-link">
                People
              </a>
              <a href="/places" className="nav-link">
                Places
              </a>
              <a href="/admin/ingest" className="nav-link" style={{ opacity: 0.7 }}>
                Ingest
              </a>
            </div>
          </div>
        </nav>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
